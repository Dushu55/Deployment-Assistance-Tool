import { semgrepScanner } from './semgrep.js';
import { sonarqubeScanner } from './sonarqube.js';
import { hadolintScanner } from './hadolint.js';
import { trivyScanner } from './trivy.js';
import { dockleScanner } from './dockle.js';
import { checkovScanner } from './checkov.js';
import { osvScanner } from './osv.js';
import { zapScanner } from './zap.js';
import { jestScanner } from './jest.js';
import { coverAgentScanner } from './cover-agent.js';
import { keployScanner } from './keploy.js';
import { k6Scanner } from './k6.js';
import { promptfooScanner } from './promptfoo.js';
import { garakScanner } from './garak.js';
import { banditScanner } from './bandit.js';
import { pipAuditScanner } from './pipAudit.js';
import { gosecScanner } from './gosec.js';
import { govulncheckScanner } from './govulncheck.js';
import { spotbugsScanner } from './spotbugs.js';
import { dependencyCheckScanner } from './dependencyCheck.js';
import { dotnetSastScanner } from './dotnetSast.js';
import { dotnetScaScanner } from './dotnetSca.js';
import { clippyScanner } from './clippy.js';
import { cargoAuditScanner } from './cargoAudit.js';
import { gitleaksScanner } from './secrets.js';
import { logicTestsScanner } from './logicTests.js';
import { httpHeadersScanner } from './httpHeaders.js';
import { npmAuditScanner } from './npmAudit.js';
import { depFreshnessScanner } from './depFreshness.js';
import { Scanner } from '../types.js';

export const ALL_SCANNERS: Scanner[] = [
  semgrepScanner,
  sonarqubeScanner,
  hadolintScanner,
  trivyScanner,
  dockleScanner,
  checkovScanner,
  osvScanner,
  zapScanner,
  jestScanner,
  coverAgentScanner,
  keployScanner,
  k6Scanner,
  promptfooScanner,
  garakScanner,
  banditScanner,
  pipAuditScanner,
  gosecScanner,
  govulncheckScanner,
  spotbugsScanner,
  dependencyCheckScanner,
  dotnetSastScanner,
  dotnetScaScanner,
  clippyScanner,
  cargoAuditScanner,
  gitleaksScanner,
  logicTestsScanner,
  httpHeadersScanner,
  npmAuditScanner,
  depFreshnessScanner
];
