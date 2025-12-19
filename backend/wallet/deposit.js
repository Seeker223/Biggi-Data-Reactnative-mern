//backend/wallet/deposit.js
router.get("/deposit-history", protect, async (req, res) => {
  try {
    const deposits = await Deposit.find({ user: req.user._id })
      .sort({ createdAt: -1 });

    res.json({ success: true, deposits });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Could not fetch deposit history" });
  }
});
