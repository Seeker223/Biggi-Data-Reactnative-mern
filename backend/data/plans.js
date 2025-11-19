//data/plans.js
export const DATA_PLANS = {
  mtn: {
    SME: [
      { id: "mtnsme_500", name: "MTN SME 500MB", amount: 150 },
      { id: "mtnsme_1", name: "MTN SME 1GB", amount: 300 },
      { id: "mtnsme_2", name: "MTN SME 2GB", amount: 600 },
    ],
    CG: [
      { id: "mtncg_500", name: "MTN CG 500MB", amount: 160 },
      { id: "mtncg_1", name: "MTN CG 1GB", amount: 320 },
    ],
  },

  glo: {
    SME: [
      { id: "glo_1", name: "GLO SME 1GB", amount: 280 },
      { id: "glo_2", name: "GLO SME 2GB", amount: 550 },
    ],
  },

  airtel: {
    GIFTING: [
      { id: "airtel_500", name: "Airtel Gifting 500MB", amount: 150 },
      { id: "airtel_1", name: "Airtel Gifting 1GB", amount: 300 },
    ],
  },

  etisalat: {
    SME: [
      { id: "eti_1", name: "9mobile SME 1GB", amount: 280 },
    ],
    CG: [
      { id: "eti_cg_500", name: "9mobile CG 500MB", amount: 140 },
    ],
  }
};
