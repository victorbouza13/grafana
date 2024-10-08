import { useEffect, useState } from 'react';
import { Route, Switch } from 'react-router-dom';

import {
  DataQueryRequest,
  DataSourceGetTagKeysOptions,
  DataSourceGetTagValuesOptions,
  PageLayoutType,
} from '@grafana/data';
import { locationService } from '@grafana/runtime';
import {
  SceneComponentProps,
  sceneGraph,
  SceneObjectBase,
  SceneObjectState,
  UrlSyncContextProvider,
} from '@grafana/scenes';
import { Page } from 'app/core/components/Page/Page';
import { getClosestScopesFacade, ScopesFacade } from 'app/features/scopes';

import { DataTrail } from './DataTrail';
import { DataTrailsHome } from './DataTrailsHome';
import { MetricsHeader } from './MetricsHeader';
import { getTrailStore } from './TrailStore/TrailStore';
import { HOME_ROUTE, TRAILS_ROUTE } from './shared';
import { getMetricName, getUrlForTrail, newMetricsTrail } from './utils';

export interface DataTrailsAppState extends SceneObjectState {
  trail: DataTrail;
  home: DataTrailsHome;
}

export class DataTrailsApp extends SceneObjectBase<DataTrailsAppState> {
  private _scopesFacade: ScopesFacade | null;

  public constructor(state: DataTrailsAppState) {
    super(state);

    this._scopesFacade = getClosestScopesFacade(this);
  }

  public enrichDataRequest(): Partial<DataQueryRequest> {
    return {
      scopes: this._scopesFacade?.value,
    };
  }

  public enrichFiltersRequest(): Partial<DataSourceGetTagKeysOptions | DataSourceGetTagValuesOptions> {
    return {
      scopes: this._scopesFacade?.value,
    };
  }

  goToUrlForTrail(trail: DataTrail) {
    locationService.push(getUrlForTrail(trail));
    this.setState({ trail });
  }

  static Component = ({ model }: SceneComponentProps<DataTrailsApp>) => {
    const { trail, home } = model.useState();

    return (
      <Switch>
        <Route
          exact={true}
          path={HOME_ROUTE}
          render={() => (
            <Page
              navId="explore/metrics"
              layout={PageLayoutType.Standard}
              renderTitle={() => <MetricsHeader />}
              subTitle=""
            >
              <home.Component model={home} />
            </Page>
          )}
        />
        <Route exact={true} path={TRAILS_ROUTE} render={() => <DataTrailView trail={trail} />} />
      </Switch>
    );
  };
}

function DataTrailView({ trail }: { trail: DataTrail }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const { metric } = trail.useState();

  useEffect(() => {
    if (!isInitialized) {
      getTrailStore().setRecentTrail(trail);
      setIsInitialized(true);
    }
  }, [trail, isInitialized]);

  if (!isInitialized) {
    return null;
  }

  return (
    <UrlSyncContextProvider scene={trail}>
      <Page navId="explore/metrics" pageNav={{ text: getMetricName(metric) }} layout={PageLayoutType.Custom}>
        <trail.Component model={trail} />
      </Page>
    </UrlSyncContextProvider>
  );
}

let dataTrailsApp: DataTrailsApp;

export function getDataTrailsApp() {
  if (!dataTrailsApp) {
    dataTrailsApp = new DataTrailsApp({
      trail: newMetricsTrail(),
      home: new DataTrailsHome({}),
      $behaviors: [
        new ScopesFacade({
          handler: (facade) => {
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            const trail = (facade.parent as DataTrailsApp).state.trail;
            sceneGraph.getTimeRange(trail).onRefresh();
          },
        }),
      ],
    });
  }

  return dataTrailsApp;
}
