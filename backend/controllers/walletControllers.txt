// controllers/walletController.js
exports.getWallet = async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({
    mainBalance: user.mainBalance,
    rewardBalance: user.rewardBalance,
  });
};

exports.deposit = async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.user.id);
  user.mainBalance += Number(amount);
  await user.save();
  res.json({ message: "Deposit successful." });
};

exports.withdraw = async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.user.id);
  if (user.mainBalance < amount)
    return res.status(400).json({ error: "Insufficient balance" });
  user.mainBalance -= Number(amount);
  await user.save();
  res.json({ message: "Withdrawal successful." });
};

exports.redeem = async (req, res) => {
  const user = await User.findById(req.user.id);
  user.mainBalance += user.rewardBalance;
  user.rewardBalance = 0;
  await user.save();
  res.json({ message: "Rewards redeemed to main balance." });
};
