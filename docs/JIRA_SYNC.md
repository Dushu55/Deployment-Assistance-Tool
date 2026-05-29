# Jira Sync Automation Guide

The Deployment Assist Tool (DAT) pushes its aggregated findings directly to DefectDojo. Once the data resides in DefectDojo, you can leverage its native Jira integration to automatically create and sync tickets for identified vulnerabilities.

## Prerequisites
1. You have deployed DefectDojo (via `infra/defectdojo/setup.sh`).
2. You have a Jira Cloud or Jira Data Center instance with API access.
3. You have run `dat scan --push-dojo` to populate your first set of findings.

## Step 1: Global Jira Configuration
First, you must link your DefectDojo instance to your Jira instance.

1. Log in to DefectDojo as an Administrator.
2. Navigate to **Configuration > Jira > Jira Instances** in the left-hand sidebar.
3. Click **Add Jira Instance**.
4. Fill out the details:
   - **URL:** `https://your-domain.atlassian.net`
   - **Username:** Your Jira integration service account email.
   - **Password / API Token:** Your Jira API Token (recommended).
   - **Issue Template:** Use the default or customise it to include DefectDojo links.
5. Save the configuration.

## Step 2: Mapping a DefectDojo Product to a Jira Project
DefectDojo maps "Products" (which correspond to your codebases) to specific Jira Projects.

1. Navigate to **Products > All Products**.
2. Select the Product that the DAT CLI is pushing to (default: `DAT Project`).
3. Click the **Settings** (gear icon) in the top right and select **Edit**.
4. Scroll down to the **Jira Configuration** section.
5. Select the Jira Instance you created in Step 1.
6. Enter the **Jira Project Key** (e.g., `SEC`, `DEV`, `DAT`).
7. **Enable "Push All Issues":** Check this box if you want every finding to generate a ticket. *We highly recommend leaving this unchecked initially, and instead pushing issues manually or by severity threshold to avoid Jira spam.*
8. Save the Product settings.

## Step 3: Enabling Auto-Push for DAT Scans
When pushing from the DAT CLI, you can enforce specific logic inside DefectDojo to only sync Critical or High vulnerabilities.

1. In DefectDojo, navigate to your Product's **Engagements**.
2. Find the engagement automatically created by DAT (e.g., `DAT Scan - 2026-05-28`).
3. You can filter findings by Severity (`Critical`, `High`).
4. Select the findings, use the bulk-edit tool, and click **Push to Jira**.

### Automated Thresholds (Advanced)
If you want DAT to *automatically* create tickets upon CI/CD execution without human intervention:
1. Go to **Configuration > System Settings**.
2. Locate the **Jira** section.
3. Ensure **Enable Jira** is checked.
4. Set the **Minimum Severity for Jira Push** to `High` or `Critical`.
*Note: Because our DAT CLI uses the `/api/v2/import-scan/` endpoint, findings imported above this severity threshold will immediately trigger a Jira webhook and create Epics/Tasks.*

## Step 4: Bi-Directional Sync
DefectDojo supports two-way syncing. If a developer moves a ticket to `Done` in Jira:
1. DefectDojo will automatically mark the finding as `Inactive` / `Mitigated`.
2. The next time the DAT CLI runs in the CI/CD pipeline, the finding will be skipped from the active report payload.
