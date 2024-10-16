import { css } from '@emotion/css';

import { dateTimeFormat, GrafanaTheme2 } from '@grafana/data';
import { SceneObjectState, AdHocFiltersVariable, SceneObjectBase } from '@grafana/scenes';
import { Card, useStyles2 } from '@grafana/ui';

// import { getStyles } from './DataTrailCard';

import { getDataSourceName } from './utils';

type Filters = AdHocFiltersVariable['state']['filters']; // type is actually AdHocFilterWithLabels[]

export interface RecentExplorationState extends SceneObjectState {
  metric?: string;
  datasource?: string;
  filters: Filters;
  createdAt: number;
}

export class RecentExplorationScene extends SceneObjectBase<RecentExplorationState> {
  static Component = RecentExploration;
}

type Props = { model: RecentExplorationScene };

function onSelect() {
  alert('select');
}

// Helper function to truncate the value for a single key:value pair
const truncateValue = (key: string, value: string, maxLength: number) => {
  const combinedLength = key.length + 2 + value.length; // 2 for ": "
  if (combinedLength > maxLength) {
    return value.substring(0, maxLength - key.length - 5) + '...'; // 5 for ": " and "..."
  }
  return value;
};

function RecentExploration({ model }: Props) {
  const styles = useStyles2(getStyles);
  const { metric, datasource, filters, createdAt } = model.useState();

  return (
    <>
      <Card onClick={onSelect} className={styles.card}>
        <Card.Heading>
          <div className={styles.metricLabel}>Metric:</div>
          <div className={styles.metricValue}>{metric}</div>
        </Card.Heading>
        <Card.Meta separator={'|'} className={styles.meta}>
          {filters.map((f, index) => (

            <span key={f.key}>
              <div className={styles.secondaryFont}>{f.key}: </div>
              <div className={styles.primaryFont}>
                {truncateValue(f.key, f.value, 44)}
              </div>
            </span>
          ))}
        </Card.Meta>
        <div className={styles.datasource}>
          <div className={styles.secondaryFont}>Datasource: </div>
          <div className={styles.primaryFont}>{datasource && getDataSourceName(datasource)}</div>
        </div>
      </Card>
      <div className={styles.date}>
        <div className={styles.secondaryFont}>Date created: </div>
        <div className={styles.primaryFont}>{createdAt && dateTimeFormat(createdAt, { format: 'YYYY-MM-DD' })}</div>
      </div>
    </>
  );
}

export function getStyles(theme: GrafanaTheme2) {
  return {
    metricLabel: css({
      display: 'inline',
      color: 'var(--text-secondary, rgba(204, 204, 220, 0.65))',
      fontFamily: 'Inter',
      fontSize: '14px',
      fontStyle: 'normal',
      fontWeight: 400,
      // lineHeight: '22px', /* 157.143% */
      // letterSpacing: '0.021px',
    }),
    metricValue: css({
      display: 'inline',
      color: 'var(--text-primary, #CCCCDC)',
      fontFamily: 'Inter',
      fontSize: '14px',
      fontStyle: 'normal',
      fontWeight: 500,
      marginLeft: '8px', // Add some space between the label and the value
      // lineHeight: '22px', /* 157.143% */
      // letterSpacing: '0.021px',
      wordBreak: 'break-all',
    }),
    tag: css({
      maxWidth: '260px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    card: css({
      padding: `12px ${theme.spacing(2)} ${theme.spacing(1)} ${theme.spacing(2)}`,
      height: '152px',
      alignItems: 'start',
      marginBottom: 0,
      borderTop: `1px solid var(--border-Weak, rgba(204, 204, 220, 0.12))`,
      borderRight: `1px solid var(--border-Weak, rgba(204, 204, 220, 0.12))`,
      borderLeft: `1px solid var(--border-Weak, rgba(204, 204, 220, 0.12))`,
      borderBottom: 'none', // Remove the bottom border
      borderRadius: '4px 4px 0 0', // Top-left and top-right corners are 4px, bottom-left and bottom-right are 0
    }),
    secondary: css({
      color: theme.colors.text.secondary,
      fontSize: '12px',
    }),
    datasource: css({
      gridArea: 'Description',
    }),
    date: css({
      border: `1px solid var(--border-Weak, rgba(204, 204, 220, 0.12))`,
      borderRadius: '0 0 4px 4px',
      padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
      backgroundColor: theme.colors.background.primary,
    }),
    meta: css({
      flexWrap: 'wrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxHeight: '54px', // 3 lines * 18px line-height
      width: '100%',
      margin: 0,
      gridArea: 'Meta',
      color: theme.colors.text.secondary,
      whiteSpace: 'nowrap',
      // lineHeight: theme.typography.body.lineHeight,
    }),
    primaryFont: css({
      display: 'inline', // render the key and value are on the same line (not vertically stacked)
      color: 'var(--text-primary, #CCCCDC)',
      fontFamily: 'Inter',
      fontSize: '12px',
      fontStyle: 'normal',
      fontWeight: '500',
      lineHeight: '18px' /* 150% */,
      letterSpacing: '0.018px',
      // whiteSpace: 'pre',
      // wordWrap: 'break-word',
    }),
    secondaryFont: css({
      display: 'inline', // render the key and value are on the same line (not vertically stacked)
      color: 'var(--text-secondary, rgba(204, 204, 220, 0.65))',
      fontFamily: 'Inter',
      fontSize: '12px',
      fontStyle: 'normal',
      fontWeight: '400',
      lineHeight: '18px' /* 150% */,
      letterSpacing: '0.018px',
      // whiteSpace: 'pre',
      // wordWrap: 'break-word',
    }),
  };
}