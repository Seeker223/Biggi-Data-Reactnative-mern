// utils/monnify.js
import axios from "axios";

export const monnifyAuth = async () => {
  const encoded = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`
  ).toString("base64");

  const res = await axios.post(
    `${process.env.MONNIFY_BASE_URL}/api/v1/auth/login`,
    {},
    {
      headers: { Authorization: `Basic ${encoded}` }
    }
  );

  return res.data.responseBody.accessToken;
};

export const verifyMonnifyTransaction = async (reference) => {
  const token = await monnifyAuth();

  const res = await axios.get(
    `${process.env.MONNIFY_BASE_URL}/api/v2/transactions/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  return res.data.responseBody;
};
