import type {
  PrototypeOpportunitySeed,
  PrototypeOverlayBucket,
  PrototypePipelineSeed,
} from "../data/model";

export const MCPHERSON_COMPANY_ID = "3c62b236-7cb3-48db-a982-18edbf6f7f9b";

export const PROTOTYPE_OPPORTUNITY_SEEDS: PrototypeOpportunitySeed[] = [
  {
    id: "c203680f-4d36-461b-b134-25aef43d62c5",
    name: "McPherson POC opportunity",
    companyId: MCPHERSON_COMPANY_ID,
    overlaySections: [
      "strategic-goals",
      "baseline-capture",
      "kpi-framework",
      "use-case-scope",
      "check-ins",
      "executive-view",
    ],
  },
  {
    id: "a3754b84-3fc4-4ad1-adeb-99c19cf7a019",
    name: "CorePay Fleet Card opportunity",
    companyId: MCPHERSON_COMPANY_ID,
    overlaySections: [
      "strategic-goals",
      "baseline-capture",
      "kpi-framework",
      "use-case-scope",
      "check-ins",
      "executive-view",
    ],
  },
];

export const PROTOTYPE_PIPELINE_SEED: PrototypePipelineSeed = {
  storageKey: "tw_opp_pipeline_v3",
  useCaseAccountCount: 1,
  strategicOpportunityCount: 3,
  layerTitles: [
    "Core Problem",
    "Optimization Opportunity",
    "Strategic Control",
  ],
};

export const PROTOTYPE_OVERLAY_BUCKETS: PrototypeOverlayBucket[] = [
  {
    legacyKeyPattern: "tw_acct_v1_<companyId>",
    scope: "company",
    providerRecordType: "company",
    providerRecordIdSource: "selected Twenty company id",
    sectionKeys: [
      "account-profile",
      "stakeholders",
      "technical-champion",
      "advocates",
      "economic-decision-makers",
    ],
    sourcePages: ["dashboard"],
  },
  {
    legacyKeyPattern: "tw_opp_v1_<opportunityId>",
    scope: "opportunity",
    providerRecordType: "opportunity",
    providerRecordIdSource: "selected Twenty opportunity id",
    sectionKeys: [
      "strategic-goals",
      "baseline-capture",
      "kpi-framework",
      "use-case-scope",
      "check-ins",
      "executive-view",
    ],
    sourcePages: ["dashboard"],
  },
  {
    legacyKeyPattern: "tw_client_<clientName>",
    scope: "company",
    providerRecordType: "company",
    providerRecordIdSource:
      "resolved company id for the client selected in the engagement tool",
    sectionKeys: [
      "client-session",
      "stakeholders",
      "baseline-capture",
      "kpi-framework",
      "use-case-scope",
      "check-ins",
      "executive-view",
    ],
    sourcePages: ["discovery-tool"],
  },
  {
    legacyKeyPattern: "tw_opp_pipeline_v3",
    scope: "app",
    providerRecordType: "app",
    providerRecordIdSource: "twenty-client-engagement",
    sectionKeys: ["use-case-pipeline", "strategic-pipeline"],
    sourcePages: ["opportunity-pipeline"],
  },
];

export const PROTOTYPE_LOCAL_STORAGE_PATTERNS = [
  "tw_acct_v1_",
  "tw_opp_v1_",
  "tw_client_",
  "tw_opp_pipeline_v3",
] as const;
