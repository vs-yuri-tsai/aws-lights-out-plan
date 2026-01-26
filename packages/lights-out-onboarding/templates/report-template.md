# AWS Resource Discovery Report

Generated: {{generated_at}}

## Summary

| Metric                     | Value                 |
| -------------------------- | --------------------- |
| Regions Scanned            | {{regions_count}}     |
| ECS Services               | {{ecs_count}}         |
| RDS Instances              | {{rds_count}}         |
| Already Tagged             | {{tagged_count}}      |
| Recommended for Lights-Out | {{recommended_count}} |

## ECS Services

| Region | Cluster | Service | Running | Auto Scaling | Lights-Out Ready |
| ------ | ------- | ------- | ------- | ------------ | ---------------- |

{{#each ecs_services}}
| {{region}} | {{clusterName}} | {{serviceName}} | {{runningCount}}/{{desiredCount}} | {{#if hasAutoScaling}}Yes{{else}}No{{/if}} | {{status_icon}} |
{{/each}}

## RDS Instances

| Region | Instance | Engine | Status | Multi-AZ | Lights-Out Ready |
| ------ | -------- | ------ | ------ | -------- | ---------------- |

{{#each rds_instances}}
| {{region}} | {{instanceId}} | {{engine}} {{engineVersion}} | {{status}} | {{#if multiAZ}}Yes{{else}}No{{/if}} | {{status_icon}} |
{{/each}}

## Recommendations

{{#each recommendations}}

### {{status_icon}} {{resourceId}}

**Type:** {{resourceType}}
**Status:** {{reason}}

{{#if suggestedConfig}}
**Suggested Tags:**

```yaml
lights-out:managed: 'true'
lights-out:env: '{{env}}'
lights-out:priority: '{{priority}}'
```

**Suggested Configuration:**

```yaml
resource_defaults:
  {{resourceType}}:
    {{#if hasAutoScaling}}
    start:
      minCapacity: {{autoScaling.minCapacity}}
      maxCapacity: {{autoScaling.maxCapacity}}
      desiredCount: {{desiredCount}}
    stop:
      minCapacity: 0
      maxCapacity: 0
      desiredCount: 0
    {{else}}
    start:
      desiredCount: {{desiredCount}}
    stop:
      desiredCount: 0
    {{/if}}
```

{{/if}}

{{/each}}

---

## Next Steps

1. **Add Tags to Resources**

   For ECS Services:

   ```bash
   aws ecs tag-resource \
     --resource-arn <service-arn> \
     --tags key=lights-out:managed,value=true \
            key=lights-out:env,value=dev \
            key=lights-out:priority,value=50
   ```

   For RDS Instances:

   ```bash
   aws rds add-tags-to-resource \
     --resource-name <instance-arn> \
     --tags Key=lights-out:managed,Value=true \
            Key=lights-out:env,Value=dev \
            Key=lights-out:priority,Value=100
   ```

2. **Create Configuration File**

   Create a new configuration file at `config/<env-name>.yml` based on the template in `config/sss-lab.yml`.

3. **Deploy**

   ```bash
   npm run deploy
   ```

4. **Test**

   ```bash
   aws lambda invoke \
     --function-name lights-out-<stage>-handler \
     --payload '{"action":"status"}' \
     out.json
   ```
