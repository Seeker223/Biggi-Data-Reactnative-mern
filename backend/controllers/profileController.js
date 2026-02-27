import User from "../models/User.js";

// -----------------------------------------------
// UPDATE PROFILE (name, phone, birthdate, etc)
// -----------------------------------------------
export const updateProfile = async (req, res) => {
  try {
    const updates = req.body;

    // prevent user from changing restricted fields
    delete updates.role;
    delete updates.password;

    const currentUser = await User.findById(req.user.id).select("referredByCode");
    if (!currentUser) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    if (updates.referredByCode) {
      if (currentUser.referredByCode) {
        return res.status(400).json({
          success: false,
          msg: "Referral code can only be set once",
        });
      }
      updates.referredByCode = String(updates.referredByCode).trim().toUpperCase();
      if (!updates.referredByCode) {
        delete updates.referredByCode;
      } else {
        const referrer = await User.findOne({ referralCode: updates.referredByCode }).select("_id");
        if (!referrer) {
          return res.status(400).json({
            success: false,
            msg: "Invalid referral code",
          });
        }
      }
    }

    if (updates.userRole) {
      const normalizedRole = String(updates.userRole).toLowerCase().trim();
      if (!["private", "merchant"].includes(normalizedRole)) {
        delete updates.userRole;
      } else {
        updates.userRole = normalizedRole;
      }
    }
    delete updates.email; // (frontend doesn’t update email)

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: err.message,
    });
  }
};

// -----------------------------------------------
// UPDATE AVATAR — your frontend uses FormData
// -----------------------------------------------
export const updateAvatar = async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ success: false, msg: "No image uploaded" });

    // Using base64 buffer for Cloudinary or others
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // SAVE IMAGE PATH DIRECTLY (no Cloudinary in your code)
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { photo: base64Image },
      { new: true }
    ).select("-password");

    if (user) {
      user.addNotification({
        type: "Profile",
        status: "success",
        message: "Profile photo updated successfully.",
      });
      await user.save();
    }

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: err.message,
    });
  }
};

// -----------------------------------------------
// GET USER NOTIFICATIONS
// -----------------------------------------------
export const getNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("notificationItems notifications");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      notifications: user.notificationItems || [],
      unread: Number(user.notifications || 0),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
};

// -----------------------------------------------
// MARK USER NOTIFICATIONS AS READ
// -----------------------------------------------
export const markNotificationsAsRead = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    (user.notificationItems || []).forEach((item) => {
      item.seen = true;
    });
    user.notifications = 0;
    await user.save();

    return res.json({
      success: true,
      message: "Notifications marked as read",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
    });
  }
};
