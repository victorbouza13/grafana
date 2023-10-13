import { css } from '@emotion/css';
import memoizeOne from 'memoize-one';
import React, { useEffect } from 'react';

import {
  DataFrame,
  ExploreLogsPanelState,
  GrafanaTheme2,
  LogsSortOrder,
  SplitOpen,
  TimeRange,
} from '@grafana/data/src';
import { Checkbox } from '@grafana/ui';
import { Themeable2 } from '@grafana/ui/src';

import { LogsTable } from './LogsTable';

interface LogsTableProps {
  logsFrames?: DataFrame[];
  width: number;
  timeZone: string;
  splitOpen: SplitOpen;
  range: TimeRange;
  logsSortOrder: LogsSortOrder;
}

interface Props extends Themeable2 {
  logsTableProps: LogsTableProps;
  panelState: ExploreLogsPanelState | undefined;
  updatePanelState: (panelState: Partial<ExploreLogsPanelState>) => void;
}

function getStyles(theme: GrafanaTheme2, height: number) {
  return {
    wrapper: css({
      display: 'flex',
    }),
    sidebar: css({
      height: height,
      fontSize: theme.typography.pxToRem(10),
      overflowY: 'scroll',
    }),
  };
}

export type fieldNameMeta = { count: number; active: boolean | undefined };
type fieldName = string;
type labelName = string;
type labelValue = string;

const getTableHeight = memoizeOne((dataFrames: DataFrame[] | undefined) => {
  const largestFrameLength = dataFrames?.reduce((length, frame) => {
    return frame.length > length ? frame.length : length;
  }, 0);
  // from TableContainer.tsx
  return Math.min(600, Math.max(largestFrameLength ?? 0 * 36, 300) + 40 + 46);
});

export const LogsTableWrap: React.FunctionComponent<Props> = (props) => {
  const { logsFrames } = props.logsTableProps;
  // Save the normalized cardinality of each label
  const [labelCardinalityState, setLabelCardinality] = React.useState<Record<fieldName, fieldNameMeta> | undefined>(
    undefined
  );

  useEffect(() => {
    // @todo cleanup
    const labelsField = logsFrames?.length ? logsFrames[0].fields.find((field) => field.name === 'labels') : undefined;
    const numberOfLogLines = logsFrames ? logsFrames[0].length : 0;

    // @todo this is a hack to get the other Fields that are used as columns, but we should have a better way to do this
    const otherFields = logsFrames?.length
      ? logsFrames[0].fields.filter(
          (field) =>
            field.name !== 'labels' &&
            field.name !== 'id' &&
            field.name !== 'tsNs' &&
            field.name !== 'Line' &&
            field.name !== 'Time'
        )
      : [];

    //@todo this map doesn't need the active state and it should be removed
    const labelCardinality = new Map<fieldName, fieldNameMeta>();
    let pendingLabelState: Record<fieldName, fieldNameMeta> = {};

    if (labelsField?.values.length && numberOfLogLines) {
      labelsField?.values.forEach((labels: Array<Record<labelName, labelValue>>) => {
        const keys = Object.keys(labels);
        keys.forEach((key) => {
          if (labelCardinality.has(key)) {
            const value = labelCardinality.get(key);
            if (value) {
              // extra conditional to appease typescript, we know we have the value with has above? @todo there has to be a better pattern
              labelCardinality.set(key, { count: value.count + 1, active: value?.active });
            }
          } else {
            labelCardinality.set(key, { count: 1, active: undefined });
          }
        });
      });

      // Converting the Map to an Object will be expensive, hoping the savings from deduping with set/map above will make up for it
      pendingLabelState = Object.fromEntries(labelCardinality);

      // Don't normalize, we want count
      // Object.keys(normalizeLabelCardinality).forEach((key) => {
      //   normalizeLabelCardinality[key].count = Math.round(
      //     (100 * normalizeLabelCardinality[key].count) / numberOfLogLines
      //   );
      // });
    }

    //
    otherFields.forEach((field) => {
      pendingLabelState[field.name] = {
        count: field.values.filter((value) => value).length,
        active: pendingLabelState[field.name]?.active,
      };
    });

    // get existing labels from url
    const previouslySelected = props.panelState?.columns;
    if (previouslySelected) {
      Object.values(previouslySelected).forEach((key) => {
        if (pendingLabelState[key]) {
          pendingLabelState[key].active = true;
        }
      });
    }

    setLabelCardinality(pendingLabelState);
    // We don't want to update the state if the url changes, we want to update the active state when the data is changed.
  }, [logsFrames, props.panelState?.columns]);

  const toggleColumn = (columnName: fieldName) => {
    if (!labelCardinalityState || !(columnName in labelCardinalityState)) {
      console.warn('failed to get column', labelCardinalityState);
      return;
    }
    const pendingLabelCardinality = {
      ...labelCardinalityState,
      [columnName]: { ...labelCardinalityState[columnName], active: !labelCardinalityState[columnName]?.active },
    };

    // Set local state
    setLabelCardinality(pendingLabelCardinality);

    const newPanelState: ExploreLogsPanelState = {
      ...props.panelState,
      // URL format requires our array of values be an object, so we convert it using object.assign
      columns: Object.assign(
        {},
        // Get the keys of the object as an array
        Object.keys(pendingLabelCardinality)
          // Only include active filters
          .filter((key) => pendingLabelCardinality[key]?.active)
      ),
      visualisationType: 'table',
    };

    // Update url state
    props.updatePanelState(newPanelState);
  };

  const Columns = (props: {
    labels: Record<fieldName, fieldNameMeta>;
    valueFilter: (value: number) => boolean;
  }): JSX.Element => {
    const { labels, valueFilter } = props;
    if (labels) {
      const labelKeys = Object.keys(labels);

      return (
        <div>
          {labelKeys
            .filter((labelName) => valueFilter(labels[labelName].count))
            .map((labelName) => (
              <div key={labelName}>
                <Checkbox
                  label={labelName}
                  onChange={() => toggleColumn(labelName)}
                  checked={labels[labelName]?.active}
                />
                <>({labels[labelName]?.count})</>
              </div>
            ))}
        </div>
      );
    }

    return <div></div>;
  };

  console.info('RENDER', labelCardinalityState);

  if (!labelCardinalityState) {
    return null;
  }

  const height = getTableHeight(logsFrames);
  const styles = getStyles(props.theme, height);

  return (
    <div className={styles.wrapper}>
      <section className={styles.sidebar}>
        <div>Columns</div>
        <div>Available</div>
        <Columns labels={labelCardinalityState} valueFilter={(value) => !!value} />
        <div>Empty</div>
        <Columns labels={labelCardinalityState} valueFilter={(value) => !value} />
      </section>
      <LogsTable
        logsSortOrder={props.logsTableProps.logsSortOrder}
        range={props.logsTableProps.range}
        splitOpen={props.logsTableProps.splitOpen}
        timeZone={props.logsTableProps.timeZone}
        width={props.logsTableProps.width}
        logsFrames={logsFrames}
        labelCardinalityState={labelCardinalityState}
        sparsityThreshold={80}
        height={height}
      />
    </div>
  );
};
