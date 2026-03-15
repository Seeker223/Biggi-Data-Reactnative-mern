// Canonical provider plan catalog (Zenipoint) with BiggiData markup included.
// This is the single source of truth used by seed + admin sync.

const MARKUP = 100;

const withMarkup = (p) => ({
  ...p,
  provider_amount: p.provider_amount,
  markup: MARKUP,
  amount: Number(p.provider_amount) + MARKUP,
  active: true,
});

export const providerPlanCatalog = [
  // ============================
  // MTN SME
  // ============================
  withMarkup({
    network: "mtn",
    category: "SME",
    plan_id: "mtnsme_500",
    zenipoint_code: "mtnsme_500",
    name: "MTN SME 500MB",
    validity: "7 days",
    provider_amount: 305,
  }),
  withMarkup({
    network: "mtn",
    category: "SME",
    plan_id: "mtnsme_1",
    zenipoint_code: "mtnsme_1",
    name: "MTN SME 1GB",
    validity: "30 days",
    provider_amount: 530,
  }),
  withMarkup({
    network: "mtn",
    category: "SME",
    plan_id: "mtnsme_2",
    zenipoint_code: "mtnsme_2",
    name: "MTN SME 2GB",
    validity: "30 days",
    provider_amount: 799,
  }),
  withMarkup({
    network: "mtn",
    category: "SME",
    plan_id: "mtnsme_3",
    zenipoint_code: "mtnsme_3",
    name: "MTN SME 3GB",
    validity: "30 days",
    provider_amount: 1130,
  }),
  withMarkup({
    network: "mtn",
    category: "SME",
    plan_id: "mtnsme_5",
    zenipoint_code: "mtnsme_5",
    name: "MTN SME 5GB",
    validity: "30 days",
    provider_amount: 1570,
  }),
  withMarkup({
    network: "mtn",
    category: "SME",
    plan_id: "mtnsme_10",
    zenipoint_code: "mtnsme_10",
    name: "MTN SME 10GB",
    validity: "30 days",
    provider_amount: 4330,
  }),

  // ============================
  // MTN SME2
  // ============================
  withMarkup({
    network: "mtn",
    category: "SME2",
    plan_id: "mtnsme2_500",
    zenipoint_code: "mtnsme2_500",
    name: "MTN SME2 500MB",
    validity: "1 day",
    provider_amount: 342,
  }),
  withMarkup({
    network: "mtn",
    category: "SME2",
    plan_id: "mtnsme2_1",
    zenipoint_code: "mtnsme2_1",
    name: "MTN SME2 1GB",
    validity: "1 day",
    provider_amount: 486,
  }),
  withMarkup({
    network: "mtn",
    category: "SME2",
    plan_id: "mtnsme2_2",
    zenipoint_code: "mtnsme2_2",
    name: "MTN SME2 2GB",
    validity: "2 days",
    provider_amount: 732,
  }),
  withMarkup({
    network: "mtn",
    category: "SME2",
    plan_id: "mtnsme2_3",
    zenipoint_code: "mtnsme2_3",
    name: "MTN SME2 3GB",
    validity: "7 days",
    provider_amount: 1454,
  }),
  withMarkup({
    network: "mtn",
    category: "SME2",
    plan_id: "mtnsme2_5",
    zenipoint_code: "mtnsme2_5",
    name: "MTN SME2 5GB",
    validity: "7 days",
    provider_amount: 2435,
  }),
  withMarkup({
    network: "mtn",
    category: "SME2",
    plan_id: "mtnsme2_10",
    zenipoint_code: "mtnsme2_10",
    name: "MTN SME2 10GB",
    validity: "30 days",
    provider_amount: 4352,
  }),

  // ============================
  // GLO CG
  // ============================
  withMarkup({
    network: "glo",
    category: "CG",
    plan_id: "glocg_200",
    zenipoint_code: "glocg_200",
    name: "GLO CG 200MB",
    validity: "14 days",
    provider_amount: 105,
  }),
  withMarkup({
    network: "glo",
    category: "CG",
    plan_id: "glocg_500",
    zenipoint_code: "glocg_500",
    name: "GLO CG 500MB",
    validity: "30 days",
    provider_amount: 210,
  }),
  withMarkup({
    network: "glo",
    category: "CG",
    plan_id: "glocg_1",
    zenipoint_code: "glocg_1",
    name: "GLO CG 1GB",
    validity: "30 days",
    provider_amount: 405,
  }),
  withMarkup({
    network: "glo",
    category: "CG",
    plan_id: "glocg_2",
    zenipoint_code: "glocg_2",
    name: "GLO CG 2GB",
    validity: "30 days",
    provider_amount: 810,
  }),
  withMarkup({
    network: "glo",
    category: "CG",
    plan_id: "glocg_3",
    zenipoint_code: "glocg_3",
    name: "GLO CG 3GB",
    validity: "30 days",
    provider_amount: 1215,
  }),
  withMarkup({
    network: "glo",
    category: "CG",
    plan_id: "glocg_5",
    zenipoint_code: "glocg_5",
    name: "GLO CG 5GB",
    validity: "30 days",
    provider_amount: 2025,
  }),
  withMarkup({
    network: "glo",
    category: "CG",
    plan_id: "glocg_10",
    zenipoint_code: "glocg_10",
    name: "GLO CG 10GB",
    validity: "30 days",
    provider_amount: 4050,
  }),

  // ============================
  // AIRTEL CG (note: provider codes are airtelsme_* per your list)
  // ============================
  withMarkup({
    network: "airtel",
    category: "CG",
    plan_id: "airtelsme_100",
    zenipoint_code: "airtelsme_100",
    name: "Airtel CG 100MB",
    validity: "1/7 days",
    provider_amount: 300,
  }),
  withMarkup({
    network: "airtel",
    category: "CG",
    plan_id: "airtelsme_300",
    zenipoint_code: "airtelsme_300",
    name: "Airtel CG 300MB",
    validity: "1/7 days",
    provider_amount: 309,
  }),
  withMarkup({
    network: "airtel",
    category: "CG",
    plan_id: "airtelsme_1",
    zenipoint_code: "airtelsme_1",
    name: "Airtel CG 1GB",
    validity: "30 days",
    provider_amount: 1120,
  }),
];

