import DepositFeeSettings from "../models/DepositFeeSettings.js";

export const getDepositFeeSettings = async () => {
  let settings = await DepositFeeSettings.findOne();
  if (!settings) {
    settings = await DepositFeeSettings.create({
      enabled: true,
      flatFee: 5,
      percentFee: 0,
      minFee: 0,
      maxFee: 0,
    });
  }
  return settings;
};

export const computeDepositFee = (amount, settings) => {
  const base = Number(amount || 0);
  if (!settings || settings.enabled === false) return 0;
  const flat = Number(settings.flatFee || 0);
  const pct = Number(settings.percentFee || 0);
  let fee = flat + (pct > 0 ? (base * pct) / 100 : 0);
  const minFee = Number(settings.minFee || 0);
  const maxFee = Number(settings.maxFee || 0);
  if (minFee > 0 && fee < minFee) fee = minFee;
  if (maxFee > 0 && fee > maxFee) fee = maxFee;
  return Math.max(0, Math.round(fee));
};
