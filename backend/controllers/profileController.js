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

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({
      success: false,
      msg: err.message,
    });
  }
};
