// controllers/planController.js
import { DATA_PLANS } from "../data/plans.js";


export const getLocalPlans = async (req, res) => {
  try {
    const { network, category } = req.params;

    if (!DATA_PLANS[network] || !DATA_PLANS[network][category]) {
      return res.status(404).json({
        success: false,
        msg: "No plans found for this network/category",
      });
    }

    return res.json({
      success: true,
      plans: DATA_PLANS[network][category],
    });
  } catch (err) {
    return res.status(500).json({ success: false, msg: "Server Error" });
  }
};
