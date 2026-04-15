import BiggiHouseHouse from "../models/BiggiHouseHouse.js";

export const ensureBiggiHouseSeed = async () => {
  const count = await BiggiHouseHouse.countDocuments();
  if (count > 0) return;

  const docs = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    return { number, minimum: number * 100, active: true };
  });

  await BiggiHouseHouse.insertMany(docs);
};

