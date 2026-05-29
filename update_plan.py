import re

with open('IMPLEMENTATION_PLAN.md', 'r') as f:
    content = f.read()

# Update top status
content = content.replace('**Current Status:** `Phase 2 Completed` | `Phases 3-6 Pending`', '**Current Status:** `Phases 1-4, 6 Completed` | `Phase 5 Pending`')

# Phase 3
content = content.replace('## ⏳ Phase 3: Test Intelligence (Automated Generation & Execution)\n**Status:** PLANNED', '## ✅ Phase 3: Test Intelligence (Automated Generation & Execution)\n**Status:** COMPLETED')
content = content.replace('### Planned Tasks\n- [ ] **Qodo Cover-Agent', '### Tasks Completed\n- [x] **Qodo Cover-Agent')
content = content.replace('- [ ] **Jest', '- [x] **Jest')
content = content.replace('- [ ] **Keploy', '- [x] **Keploy')
content = content.replace('- [ ] **k6', '- [x] **k6')
content = content.replace('### Testing Strategy (To Do)', '### Testing Strategy (Completed)')

# Phase 4
content = content.replace('## ⏳ Phase 4: Aggregation (Dashboard & Finding Management)\n**Status:** PLANNED', '## ✅ Phase 4: Aggregation (Dashboard & Finding Management)\n**Status:** COMPLETED')
content = content.replace('- [ ] **DefectDojo', '- [x] **DefectDojo')
content = content.replace('- [ ] **Scanner API', '- [x] **Scanner API')
content = content.replace('- [ ] **Deployment Readiness Score', '- [x] **Deployment Readiness Score')
content = content.replace('- [ ] **Dependency-Track', '- [x] **Dependency-Track')
content = content.replace('- [ ] **Jira Ticketing', '- [x] **Jira Ticketing')
content = content.replace('- [ ] **Report Exporter', '- [x] **Report Exporter (CSV/PDF)')

# Phase 6
content = content.replace('## ⏳ Phase 6: LLM Security & Red Teaming (AI-Native Applications)\n**Status:** PLANNED', '## ✅ Phase 6: LLM Security & Red Teaming (AI-Native Applications)\n**Status:** COMPLETED')
content = content.replace('- [ ] **Promptfoo', '- [x] **Promptfoo')
content = content.replace('- [ ] **Garak', '- [x] **Garak')

with open('IMPLEMENTATION_PLAN.md', 'w') as f:
    f.write(content)
