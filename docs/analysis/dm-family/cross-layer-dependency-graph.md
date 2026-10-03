# Cross-layer dependency graph

Edges show primary data/control flow (not every diagnostic or menu entry).

```mermaid
flowchart TB
  subgraph workbook [Workbook tabs]
    SFDC[SFDC_Deployments / PF / Contacts / History / Wellness / DHP]
    OVR[DeploymentOverrides / GoLivesOverrides / DeploymentsMeta]
    USR[AppUsers]
    RPT[Dashboard / TBLs / HealthReportSnapshots / ExecSummary]
    OPS[NotificationConfig / ReportDistributionLog / CSAT_InFlight]
    DNU[DNU_Go Lives / DNU_ActiveDeployments]
  end

  subgraph config [APP_CONFIG Config_*.js]
    SHEETS[sheets.* tab names]
    MODE[activeDeployments productMode or industry]
    UI[ui.tabs / roleVisibility / tables]
    MOD[report / notify / trends / student / escalations]
  end

  subgraph shell [App shell *_DM]
    WAC[WebAppCode.js wrappers]
    CODE[Code.js menus triggers]
    MAN[appsscript.json CoreLib pin]
  end

  subgraph dep [DepMngr CoreLib]
    CD[CoreData]
    CU[CoreUsers]
    CR[CoreReport / CoreAnalytics]
    CN[CoreNotify / CoreDistribute]
    CUI[CoreUI_Markup / CoreUI_Js / CoreUI_Css]
    CT[CoreTrends / CorePortfolioHealth / CorePortfolioMomentum]
    CNO[CoreNotable / CoreEscalations]
  end

  subgraph client [Browser]
    RUN[google.script.run]
    DOM[DM Web UI tabs modals]
  end

  SHEETS --> CD
  MODE --> CD
  UI --> CUI
  MOD --> CR
  MOD --> CN
  MOD --> CT

  SFDC --> CD
  OVR --> CD
  USR --> CU
  RPT --> CR
  RPT --> CR
  OPS --> CN
  DNU -.->|formula feeds| RPT

  MAN --> CD
  WAC --> CD
  WAC --> CU
  WAC --> CR
  WAC --> CN
  WAC --> CT
  WAC --> CNO
  CODE --> CD
  CODE --> CR

  CUI --> DOM
  RUN --> WAC
  DOM --> RUN
```

## Layer contracts

| From | To | Contract |
|------|-----|----------|
| Workbook | `APP_CONFIG.sheets` | Literal tab names; wrong name → empty maps (often silent) |
| `APP_CONFIG` | CoreData | `activeDeployments.*` defines portfolio membership (Mechanism A) |
| `APP_CONFIG` | CoreUI | `ui.*` defines visible tabs/columns/modals |
| CoreUI_Js | WebAppCode | Curated `google.script.run.*` methods (see contracts doc) |
| WebAppCode | CoreLib | `CoreLib.<Module>.<fn>(APP_CONFIG, …)` |
| Named ranges | CoreReport | `HealthTotal`, `RedYellow`, etc. on `Dashboard` / `RedYellow_TBL` |

## Mode split (intentional)

| Apps | Mode | Config block |
|------|------|----------------|
| SLG, HC, HENP | IndustryMode-style | `activeDeployments` status/industry filters + union rules |
| EVI, HS, PDX | ProductMode | `activeDeployments.productMode*` + optional `ui.productFilter` |

HENP adds **Student** workbook tab + `student.enabled` UI tab.

PDX adds **Escalations** sheets + `getEscalationsDashboardData`.

## Preview/local dev gap

`preview_engine.py` inlines DepMngr UI strings but **does not** execute CoreData. Interactive tabs require mock `google.script.run` handlers returning shapes documented in [google-script-run-contracts.md](./google-script-run-contracts.md).
