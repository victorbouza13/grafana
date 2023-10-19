import { css } from '@emotion/css';
import React from 'react';

import { getFrameDisplayName, GrafanaTheme2, SelectableValue } from '@grafana/data';
import { config } from '@grafana/runtime';
import {
  AdHocFiltersVariable,
  PanelBuilders,
  QueryVariable,
  SceneComponentProps,
  SceneDataNode,
  SceneFlexItem,
  SceneFlexItemLike,
  SceneFlexLayout,
  sceneGraph,
  SceneObject,
  SceneObjectBase,
  SceneObjectState,
  SceneQueryRunner,
  SceneVariableSet,
} from '@grafana/scenes';
import { Button, Field, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { ALL_VARIABLE_VALUE } from 'app/features/variables/constants';

import { AddToFiltersGraphAction } from '../AddToFiltersGraphAction';
import { ByFrameRepeater } from '../ByFrameRepeater';
import { LayoutSwitcher } from '../LayoutSwitcher';
import { trailsDS, VAR_FILTERS, VAR_FILTERS_EXPR, VAR_GROUP_BY, VAR_METRIC_EXPR } from '../shared';

export interface BreakdownSceneState extends SceneObjectState {
  body?: SceneObject;
  labels: Array<SelectableValue<string>>;
  value?: string;
  loading?: boolean;
}

/**
 * Just a proof of concept example of a behavior
 */
export class BreakdownScene extends SceneObjectBase<BreakdownSceneState> {
  constructor(state: Partial<BreakdownSceneState>) {
    super({
      $variables: state.$variables ?? getVariableSet(),
      labels: state.labels ?? [],
      ...state,
    });

    this.addActivationHandler(this._onActivate.bind(this));
  }

  private _onActivate() {
    const variable = this.getVariable();

    variable.subscribeToState((newState, oldState) => {
      if (
        newState.options !== oldState.options ||
        newState.value !== oldState.value ||
        newState.loading !== oldState.loading
      ) {
        this.updateBody(variable);
      }
    });

    this.updateBody(variable);
  }

  private getVariable(): QueryVariable {
    const variable = sceneGraph.lookupVariable(VAR_GROUP_BY, this)!;
    if (!(variable instanceof QueryVariable)) {
      throw new Error('Group by variable not found');
    }

    return variable;
  }

  private updateBody(variable: QueryVariable) {
    const options = this.getLabelOptions(variable);

    const stateUpdate: Partial<BreakdownSceneState> = {
      loading: variable.state.loading,
      value: String(variable.state.value),
      labels: options,
    };

    if (!this.state.body && !variable.state.loading) {
      stateUpdate.body = variable.hasAllValue() ? buildAllLayout(options) : buildNormalLayout();
    }

    this.setState(stateUpdate);
  }

  private getLabelOptions(variable: QueryVariable) {
    const labelFilters = sceneGraph.lookupVariable(VAR_FILTERS, this);
    const labelOptions: Array<SelectableValue<string>> = [];

    if (!(labelFilters instanceof AdHocFiltersVariable)) {
      return [];
    }

    const filters = labelFilters.state.set.state.filters;

    for (const option of variable.getOptionsForSelect()) {
      const filterExists = filters.find((f) => f.key === option.value);
      if (!filterExists) {
        labelOptions.push({ label: option.label, value: String(option.value) });
      }
    }

    return labelOptions;
  }

  public onChange = (value: string) => {
    const variable = this.getVariable();

    if (value === ALL_VARIABLE_VALUE) {
      this.setState({ body: buildAllLayout(this.getLabelOptions(variable)) });
    } else if (variable.hasAllValue()) {
      this.setState({ body: buildNormalLayout() });
    }

    variable.changeValueTo(value);
  };

  public static Component = ({ model }: SceneComponentProps<BreakdownScene>) => {
    const { labels, body, loading, value } = model.useState();
    const styles = useStyles2(getStyles);

    return (
      <div className={styles.container}>
        {loading && <div>Loading...</div>}
        <div className={styles.controls}>
          <Field label="By label">
            <RadioButtonGroup options={labels} value={value} onChange={model.onChange} />
          </Field>
          {body instanceof LayoutSwitcher && (
            <div className={styles.controlsRight}>
              <body.Selector model={body} />
            </div>
          )}
        </div>
        <div className={styles.content}>{body && <body.Component model={body} />}</div>
      </div>
    );
  };
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      flexGrow: 1,
      display: 'flex',
      minHeight: '100%',
      flexDirection: 'column',
    }),
    content: css({
      flexGrow: 1,
      display: 'flex',
      paddingTop: theme.spacing(0),
    }),
    tabHeading: css({
      paddingRight: theme.spacing(2),
      fontWeight: theme.typography.fontWeightMedium,
    }),
    controls: css({
      flexGrow: 0,
      display: 'flex',
      alignItems: 'top',
      gap: theme.spacing(2),
    }),
    controlsRight: css({
      flexGrow: 1,
      display: 'flex',
      justifyContent: 'flex-end',
    }),
  };
}

export function buildAllLayout(options: Array<SelectableValue<string>>) {
  const children: SceneFlexItemLike[] = [];

  for (const option of options) {
    if (option.value === ALL_VARIABLE_VALUE) {
      continue;
    }

    children.push(
      new SceneFlexItem({
        minHeight: 250,
        minWidth: 450,
        body: PanelBuilders.timeseries()
          .setTitle(option.label!)
          .setData(
            new SceneQueryRunner({
              queries: [
                {
                  refId: 'A',
                  datasource: trailsDS,
                  expr: `sum(rate(${VAR_METRIC_EXPR}${VAR_FILTERS_EXPR}[$__rate_interval])) by(${option.value})`,
                },
              ],
            })
          )
          .setHeaderActions(new SelectLabelAction({ labelName: String(option.value) }))
          .build(),
      })
    );
  }

  return new SceneFlexLayout({
    direction: 'row',
    children: children,
    wrap: 'wrap',
  });
}

function getVariableSet() {
  return new SceneVariableSet({
    variables: [
      new QueryVariable({
        name: VAR_GROUP_BY,
        label: 'Group by',
        datasource: trailsDS,
        includeAll: true,
        query: { query: `label_names(${VAR_METRIC_EXPR})`, refId: 'A' },
        value: '',
        text: '',
      }),
    ],
  });
}

function buildNormalLayout() {
  return new LayoutSwitcher({
    $data: new SceneQueryRunner({
      queries: [
        {
          refId: 'A',
          datasource: { uid: 'gdev-prometheus' },
          expr: 'sum(rate(${metric}{${filters}}[$__rate_interval])) by($groupby)',
        },
      ],
    }),
    options: [
      { value: 'single', label: 'Single' },
      { value: 'grid', label: 'Grid' },
      { value: 'rows', label: 'Rows' },
    ],
    active: 'grid',
    layouts: [
      new SceneFlexLayout({
        direction: 'column',
        children: [
          new SceneFlexItem({
            minHeight: 300,
            body: PanelBuilders.timeseries().setTitle('$metric').build(),
          }),
        ],
      }),
      new ByFrameRepeater({
        body: new SceneFlexLayout({
          direction: 'row',
          children: [],
          wrap: 'wrap',
        }),
        getLayoutChild: (data, frame, frameIndex) => {
          return new SceneFlexItem({
            minHeight: 180,
            minWidth: 350,
            body: PanelBuilders.timeseries()
              .setTitle(getFrameDisplayName(frame, frameIndex))
              .setData(new SceneDataNode({ data: { ...data, series: [frame] } }))
              .setOption('legend', { showLegend: false })
              .setColor({ mode: 'fixed', fixedColor: getColorByIndex(frameIndex) })
              .setCustomFieldConfig('fillOpacity', 9)
              .setHeaderActions(new AddToFiltersGraphAction({ frame }))
              .build(),
          });
        },
      }),
      new ByFrameRepeater({
        body: new SceneFlexLayout({
          direction: 'column',
          children: [],
        }),
        getLayoutChild: (data, frame, frameIndex) => {
          return new SceneFlexItem({
            minHeight: 180,
            body: PanelBuilders.timeseries()
              .setTitle(getFrameDisplayName(frame, frameIndex))
              .setData(new SceneDataNode({ data: { ...data, series: [frame] } }))
              .setOption('legend', { showLegend: false })
              .setColor({ mode: 'fixed', fixedColor: getColorByIndex(frameIndex) })
              .setCustomFieldConfig('fillOpacity', 9)
              .setHeaderActions(new AddToFiltersGraphAction({ frame }))
              .build(),
          });
        },
      }),
    ],
  });
}

export function buildBreakdownActionScene() {
  return new SceneFlexItem({
    body: new BreakdownScene({}),
  });
}

export function builAllScene(variable: QueryVariable) {}

function getColorByIndex(index: number) {
  const visTheme = config.theme2.visualization;
  return visTheme.getColorByName(visTheme.palette[index % 5]);
}

interface SelectLabelActionState extends SceneObjectState {
  labelName: string;
}
export class SelectLabelAction extends SceneObjectBase<SelectLabelActionState> {
  public onClick = () => {
    getBreakdownSceneFor(this).onChange(this.state.labelName);
  };

  public static Component = ({ model }: SceneComponentProps<AddToFiltersGraphAction>) => {
    return (
      <Button variant="primary" size="sm" fill="text" onClick={model.onClick}>
        Select
      </Button>
    );
  };
}

function getBreakdownSceneFor(model: SceneObject): BreakdownScene {
  if (model instanceof BreakdownScene) {
    return model;
  }

  if (model.parent) {
    return getBreakdownSceneFor(model.parent);
  }

  throw new Error('Unable to find breakdown scene');
}
