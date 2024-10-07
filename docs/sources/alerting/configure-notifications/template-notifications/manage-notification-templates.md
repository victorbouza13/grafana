---
aliases:
  - ../../manage-notifications/template-notifications/create-notification-templates/ # /docs/grafana/<GRAFANA_VERSION>/alerting/manage-notifications/template-notifications/create-notification-templates/
  - ../../manage-notifications/template-notifications/use-notification-templates/ # /docs/grafana/<GRAFANA_VERSION>/alerting/manage-notifications/template-notifications/use-notification-templates/
  - ../../configure-notifications/template-notifications/use-notification-templates/ # /docs/grafana/<GRAFANA_VERSION>/alerting/manage-notifications/template-notifications/use-notification-templates/
  - ../../configure-notifications/template-notifications/create-notification-templates/ # /docs/grafana/<GRAFANA_VERSION>/alerting/manage-notifications/template-notifications/create-notification-templates/
canonical: https://grafana.com/docs/grafana/latest/alerting/configure-notifications/template-notifications/manage-notification-templates/
description: Create notification templates to sent to your contact points
keywords:
  - grafana
  - alerting
  - notifications
  - templates
  - create templates
  - edit templates
  - delete templates
labels:
  products:
    - cloud
    - enterprise
    - oss
title: Manage notification templates
menuTitle: Manage templates
weight: 101
refs:
  create-notification-templates:
    - pattern: /docs/grafana/
      destination: /docs/grafana/<GRAFANA_VERSION>/alerting/configure-notifications/template-notifications/create-notification-templates/
    - pattern: /docs/grafana-cloud/
      destination: /docs/grafana-cloud/alerting-and-irm/alerting/configure-notifications/template-notifications/create-notification-templates/
  using-go-templating-language:
    - pattern: /docs/grafana/
      destination: /docs/grafana/<GRAFANA_VERSION>/alerting/configure-notifications/template-notifications/language/
    - pattern: /docs/grafana-cloud/
      destination: /docs/grafana-cloud/alerting-and-irm/alerting/configure-notifications/template-notifications/language/
---

# Manage notification templates

Lorem ipsum

## Create notification templates

Create reusable notification templates to send to your contact points.

You can add one or more templates to your notification template.

Your notification template name must be unique. You cannot have two templates with the same name in the same notification template or in different notification templates. Avoid defining templates with the same name as default templates, such as: `__subject`, `__text_values_list`, `__text_alert_list`, `default.title` and `default.message`.

To create a notification template, complete the following steps.

1. Click **Alerts & IRM** -> **Contact points**.
1. Click the **Notification Templates** tab and then **+ Add notification template**.

1. Enter a name for the notification template.

1. Write the content of the template in the content field.

1. Save your changes.

`{{ define "email.subject" }}` and `{{ end }}` is automatically added to the start and end of the content:

To create a notification template that contains more than one template:

1. Click **+ Add notification template**.

2. Enter a name for the notification template.

3. Write each template in the Content field, including `{{ define "name-of-template" }}` and `{{ end }}` at the start and end of each template.

4. Save your changes.

To create a notification template that makes reference to a annotation. For example a summary annotation.

1. Navigate to **Alerts & IRM** and edit your alert rule.
1. Add a **summary** annotation to your alert rule, and click **Save rule and exit**.

    Example of a summary annotation that will ouput the labels of "instance":

    ```
    The database server {{ index $labels "instance" }} has exceeded 75% of available disk space
    ```
1. Navigate back to the notification template.
1. Ensure that `summary` is defined in the notification template. Similarly, if you create a notification template that makes reference to a description annotation, or runbook url, you must define the `description`, or `runbook_url` annotation in the template.

   Example of mapping a summary annotation to a notification template.

   ```
   {{ define "alerts.summarize" -}}
   {{ range . -}}
   - {{ index .Annotations "summary" }}
   {{ end }}
   {{ end }}
   ```

    Note that the word "summary" is present in the line where the index function, which will print the summary annotation.

## Use notification templates

Use templates in contact points to customize your notifications.

Complete the following steps to add templates to your contact point.

1. Click an existing contact point or create a new one
1. In **Optional settings**, click any field that contains templates.

   For example, if you are creating an email contact point integration, click **Message** or **Subject**.

1. Click **Edit**.
   A dialog box opens where you can select templates.
1. Click **Select existing template** to select a template and preview it using the default payload.

   You can also copy the selected template and use it in the custom tab.

1. Click **Enter custom message** to customize and edit the field directly. Note that the title changes depending on the field you are editing.

1. You can switch between the two tabs to access the list of available templates and copy them across to the customized version.

1. Click **Save contact point**.

## Preview notification templates

Preview how your notification templates should look before using them in your contact points, helping you understand the result of the template you are creating as well as enabling you to fix any errors before saving it.

**Note:** This feature is only for Grafana Alertmanager.

To preview your notification templates:

1. Navigate to **Alerts&IRM** -> **Alerting** -> **Contact points** -> **Notification Templates**.
1. Click **+ Add notification template** or edit an existing template.
1. Add or update your template content.

   Default data is provided and you can add or edit alert data to it as well as alert instances. You can add alert data directly in the Payload data window itself or click **Select alert instances** or **Add custom alerts**.

1. Optional: To add alert data from existing alert instances:

   a. Click **Select alert instances**.

   b. Hover over the alert instances to view more information on each alert instance.

   c. Click **Confirm** to add the alert instance(s) to the payload.

1. Optional: To add alert data using the Alert data editor, click **Add custom data:**

   a. Add annotations, custom labels and/or set a dashboard or a panel.

   b. Toggle Firing/resolved depending on whether you want to add firing or resolved alerts to your notification.

   c. Click **Add alert data**.

   d. Click **Refresh preview** to see what your template content should look like and the corresponding payload data.

   If there are any errors in your template, they are displayed in the Preview and you can correct them before saving.

1. Save your changes.