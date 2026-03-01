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

// -----------------------------------------------
// GET USER REFERRALS
// -----------------------------------------------
export const getReferrals = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("referralCode");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.referralCode) {
      return res.json({ success: true, count: 0, referrals: [] });
    }

    const referrals = await User.find({ referredByCode: user.referralCode })
      .select("username photo state createdAt");

    return res.json({
      success: true,
      count: referrals.length,
      referrals,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch referrals",
    });
  }
};

// -----------------------------------------------
// GET TRANSACTION SECURITY STATUS
// -----------------------------------------------
export const getTransactionSecurityStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("+transactionPinHash biometricAuth.enabled");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.json({
      success: true,
      security: {
        transactionPinEnabled: Boolean(user.transactionPinHash),
        biometricEnabled: Boolean(user.biometricAuth?.enabled),
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transaction security status",
    });
  }
};

// -----------------------------------------------
// SET OR UPDATE TRANSACTION PIN (4 DIGITS)
// -----------------------------------------------
export const setTransactionPin = async (req, res) => {
  try {
    const pin = String(req.body?.pin || "").trim();
    const currentPin = String(req.body?.currentPin || "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be exactly 4 digits",
      });
    }

    const user = await User.findById(req.user.id).select("+transactionPinHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.transactionPinHash) {
      if (!/^\d{4}$/.test(currentPin)) {
        return res.status(400).json({
          success: false,
          message: "Current PIN is required to update PIN",
        });
      }
      const isCurrentPinValid = await user.matchTransactionPin(currentPin);
      if (!isCurrentPinValid) {
        return res.status(401).json({
          success: false,
          message: "Current PIN is incorrect",
        });
      }
    }

    await user.setTransactionPin(pin);
    user.addNotification({
      type: "Security",
      status: "success",
      message: "Transaction PIN updated successfully.",
    });
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: "Transaction PIN saved successfully",
      transactionPinEnabled: true,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to save transaction PIN",
    });
  }
};

// -----------------------------------------------
// DISABLE TRANSACTION PIN
// -----------------------------------------------
export const disableTransactionPin = async (req, res) => {
  try {
    const currentPin = String(req.body?.currentPin || "").trim();
    const user = await User.findById(req.user.id).select("+transactionPinHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (!user.transactionPinHash) {
      return res.json({
        success: true,
        message: "Transaction PIN already disabled",
        transactionPinEnabled: false,
      });
    }
    if (!/^\d{4}$/.test(currentPin)) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is required",
      });
    }
    const isPinValid = await user.matchTransactionPin(currentPin);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        message: "Current PIN is incorrect",
      });
    }

    user.transactionPinHash = null;
    user.addNotification({
      type: "Security",
      status: "info",
      message: "Transaction PIN disabled.",
    });
    await user.save({ validateBeforeSave: false });

    return res.json({
      success: true,
      message: "Transaction PIN disabled",
      transactionPinEnabled: false,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to disable transaction PIN",
    });
  }
};
