-- 本站流量 (/observe): daily GA4 and Search Console aggregates per Taipei day × source × metric × item (page path,
-- channel group, device, event, vital rating; '' for totals). source ga|gsc|rt (GA Realtime, replaced every run)|meta.
-- The cache worker (site.analytics.sync / site.analytics.live) replaces windows of rows; the report principal reads.
-- Production provisioning: tools/site-metrics-upgrade.mjs.
CREATE TABLE IF NOT EXISTS ts_site_metrics (
 day DATE NOT NULL,
 source VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 metric VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 item VARCHAR(255) NOT NULL DEFAULT '',
 value DOUBLE NOT NULL,
 PRIMARY KEY (day,source,metric,item),
 INDEX site_metrics_metric_day (source,metric,day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
