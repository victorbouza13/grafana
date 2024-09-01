import { DataLink, LinkModel } from '@grafana/data';
import {
  SceneComponentProps,
  sceneGraph,
  SceneGridLayout,
  SceneGridRow,
  SceneObject,
  SceneObjectBase,
  SceneObjectState,
  VizPanel,
} from '@grafana/scenes';
import { Button } from '@grafana/ui';
import { GRID_COLUMN_COUNT } from 'app/core/constants';

import { DashboardInteractions } from '../../utils/interactions';
import {
  forceRenderChildren,
  getDashboardSceneFor,
  getDefaultRow,
  getDefaultVizPanel,
  getPanelIdForLibraryVizPanel,
  getPanelIdForVizPanel,
  NEW_PANEL_HEIGHT,
  NEW_PANEL_WIDTH,
} from '../../utils/utils';
import { DashboardGridItem } from '../DashboardGridItem';
import { LibraryVizPanel } from '../LibraryVizPanel';

import { LayoutEditChrome } from './LayoutEditChrome';
import { DashboardLayoutManager, LayoutRegistryItem, LayoutEditorProps, LayoutElementInfo } from './types';

interface DefaultGridLayoutManagerState extends SceneObjectState {
  layout: SceneGridLayout;
}

export class DefaultGridLayoutManager
  extends SceneObjectBase<DefaultGridLayoutManagerState>
  implements DashboardLayoutManager
{
  public editModeChanged(isEditing: boolean): void {
    this.state.layout.setState({ isDraggable: isEditing, isResizable: isEditing });
    forceRenderChildren(this.state.layout, true);
  }

  public cleanUpStateFromExplore(): void {
    this.state.layout.setState({
      children: this.state.layout.state.children.slice(1),
    });
  }

  public addNewRow() {
    const dashboard = getDashboardSceneFor(this);
    const row = getDefaultRow(dashboard);

    const sceneGridLayout = this.state.layout;

    // find all panels until the first row and put them into the newly created row. If there are no other rows,
    // add all panels to the row. If there are no panels just create an empty row
    const indexTillNextRow = sceneGridLayout.state.children.findIndex((child) => child instanceof SceneGridRow);
    const rowChildren = sceneGridLayout.state.children
      .splice(0, indexTillNextRow === -1 ? sceneGridLayout.state.children.length : indexTillNextRow)
      .map((child) => child.clone());

    if (rowChildren) {
      row.setState({
        children: rowChildren,
      });
    }

    sceneGridLayout.setState({ children: [row, ...sceneGridLayout.state.children] });
  }

  public removeRow(row: SceneGridRow, removePanels = false) {
    const sceneGridLayout = this.state.layout;

    const children = sceneGridLayout.state.children.filter((child) => child.state.key !== row.state.key);

    if (!removePanels) {
      const rowChildren = row.state.children.map((child) => child.clone());
      const indexOfRow = sceneGridLayout.state.children.findIndex((child) => child.state.key === row.state.key);

      children.splice(indexOfRow, 0, ...rowChildren);
    }

    sceneGridLayout.setState({ children });
  }

  public addNewPanel(): void {
    const vizPanel = getDefaultVizPanel(this.getNextPanelId());
    const sceneGridLayout = this.state.layout;

    const panelId = getPanelIdForVizPanel(vizPanel);
    const newGridItem = new DashboardGridItem({
      height: NEW_PANEL_HEIGHT,
      width: NEW_PANEL_WIDTH,
      x: 0,
      y: 0,
      body: vizPanel,
      key: `grid-item-${panelId}`,
    });

    sceneGridLayout.setState({
      children: [newGridItem, ...sceneGridLayout.state.children],
    });
  }

  public removePanel(panel: VizPanel) {
    const panels: SceneObject[] = [];
    const key = panel.parent instanceof LibraryVizPanel ? panel.parent.parent?.state.key : panel.parent?.state.key;

    if (!key) {
      return;
    }

    let row: SceneGridRow | undefined;

    try {
      row = sceneGraph.getAncestor(panel, SceneGridRow);
    } catch {
      row = undefined;
    }

    if (row) {
      row.state.children.forEach((child: SceneObject) => {
        if (child.state.key !== key) {
          panels.push(child);
        }
      });

      row.setState({ children: panels });

      this.state.layout.forceRender();

      return;
    }

    this.state.layout.forEachChild((child: SceneObject) => {
      if (child.state.key !== key) {
        panels.push(child);
      }
    });

    const layout = this.state.layout;

    if (layout instanceof SceneGridLayout) {
      layout.setState({ children: panels });
    }
  }

  public getNextPanelId(): number {
    let max = 0;

    for (const child of this.state.layout.state.children) {
      if (child instanceof DashboardGridItem) {
        const vizPanel = child.state.body;

        if (vizPanel) {
          const panelId =
            vizPanel instanceof LibraryVizPanel
              ? getPanelIdForLibraryVizPanel(vizPanel)
              : getPanelIdForVizPanel(vizPanel);

          if (panelId > max) {
            max = panelId;
          }
        }
      }

      if (child instanceof SceneGridRow) {
        //rows follow the same key pattern --- e.g.: `panel-6`
        const panelId = getPanelIdForVizPanel(child);

        if (panelId > max) {
          max = panelId;
        }

        for (const rowChild of child.state.children) {
          if (rowChild instanceof DashboardGridItem) {
            const vizPanel = rowChild.state.body;

            if (vizPanel) {
              const panelId =
                vizPanel instanceof LibraryVizPanel
                  ? getPanelIdForLibraryVizPanel(vizPanel)
                  : getPanelIdForVizPanel(vizPanel);

              if (panelId > max) {
                max = panelId;
              }
            }
          }
        }
      }
    }

    return max + 1;
  }

  public renderEditor() {
    return <ManualGridLayoutEditor layoutManager={this} />;
  }

  public getElements(): LayoutElementInfo[] {
    const elements: LayoutElementInfo[] = [];

    for (const child of this.state.layout.state.children) {
      if (child instanceof DashboardGridItem && child.state.body instanceof VizPanel) {
        elements.push({ body: child.state.body });
      }

      if (child instanceof SceneGridRow) {
        for (const rowChild of child.state.children) {
          if (rowChild instanceof DashboardGridItem && rowChild.state.body instanceof VizPanel) {
            elements.push({ body: rowChild.state.body });
          }
        }
      }
    }

    return elements;
  }

  public getLayoutId(): string {
    return 'scene-grid-layout';
  }

  public getDescriptor(): LayoutRegistryItem {
    return DefaultGridLayoutManager.getDescriptor();
  }

  public static getDescriptor(): LayoutRegistryItem {
    return {
      name: 'Default grid',
      description: 'Manually place and resize each panel',
      id: 'scene-grid-layout',
      createFromLayout: DefaultGridLayoutManager.createFromLayout,
    };
  }

  /**
   * Handle switching to the manual grid layout from other layouts
   * @param currentLayout
   * @returns
   */
  public static createFromLayout(currentLayout: DashboardLayoutManager): DefaultGridLayoutManager {
    const elements = currentLayout.getElements();
    const children: SceneObject[] = [];

    let currentY = 0;
    let currentX = 0;

    const panelHeight = 10;
    const panelWidth = GRID_COLUMN_COUNT / 3;

    for (let element of elements) {
      if (element.body instanceof VizPanel) {
        children.push(
          new DashboardGridItem({
            key: `griditem-${getPanelIdForVizPanel(element.body)}`,
            x: currentX,
            y: currentY,
            width: panelWidth,
            height: panelHeight,
            body: element.body,
          })
        );

        currentX += panelWidth;

        if (currentX + panelWidth >= GRID_COLUMN_COUNT) {
          currentX = 0;
          currentY += panelHeight;
        }
      }
    }

    return new DefaultGridLayoutManager({
      layout: new SceneGridLayout({ children: children, isDraggable: true, isResizable: true }),
    });
  }

  public static Component = ({ model }: SceneComponentProps<DefaultGridLayoutManager>) => {
    return (
      <LayoutEditChrome layoutManager={model}>
        <model.state.layout.Component model={model.state.layout} />
      </LayoutEditChrome>
    );
  };
}

function ManualGridLayoutEditor({ layoutManager }: LayoutEditorProps<DefaultGridLayoutManager>) {
  return (
    <>
      <Button
        fill="outline"
        icon="plus"
        onClick={() => {
          layoutManager.addNewPanel();
          DashboardInteractions.toolbarAddButtonClicked({ item: 'add_visualization' });
          // dashboard.setState({ editPanel: buildPanelEditScene(vizPanel, true) });
        }}
      >
        Panel
      </Button>

      <Button
        fill="outline"
        icon="plus"
        onClick={() => {
          layoutManager.addNewRow!();
          DashboardInteractions.toolbarAddButtonClicked({ item: 'add_row' });
        }}
      >
        Row
      </Button>
    </>
  );
}