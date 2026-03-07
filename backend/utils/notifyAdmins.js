import User from "../models/User.js";

export const notifyAdmins = async ({ type = "Admin Alert", message, amount = null, status = "info" }) => {
  try {
    const admins = await User.find({ role: "admin" });
    if (!admins.length) return;

    for (const admin of admins) {
      admin.addNotification({
        type,
        message: String(message || "Admin notification"),
        amount,
        status,
      });
      await admin.save({ validateBeforeSave: false });
    }
  } catch (error) {
    console.error("notifyAdmins error:", error?.message || error);
  }
};

