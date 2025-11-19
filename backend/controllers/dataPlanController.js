import DataPlan from "../models/DataPlan.js";

/* Create */
export const createPlan = async (req, res) => {
  try {
    const plan = await DataPlan.create(req.body);
    res.json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
};

/* Update */
export const updatePlan = async (req, res) => {
  try {
    const plan = await DataPlan.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json({ success: true, plan });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
};

/* Delete */
export const deletePlan = async (req, res) => {
  try {
    await DataPlan.findByIdAndDelete(req.params.id);
    res.json({ success: true, msg: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
};

/* Get All Plans */
export const getAllPlans = async (req, res) => {
  try {
    const plans = await DataPlan.find();
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
};

/* Get Plans by Category */
export const getPlansByCategory = async (req, res) => {
  try {
    const { network, category } = req.params;

    const plans = await DataPlan.find({ network, category });

    if (!plans.length) {
      return res.status(404).json({
        success: false,
        msg: "No plans available",
      });
    }

    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
};
