import axios from "axios";

const ZENI_API_URL = "https://zenipoint.com/api";
const ZENI_API_KEY = process.env.ZENI_API_KEY;
const ZENI_CONTRACT_KEY = process.env.ZENI_CONTRACT_KEY;

const authHeader = Buffer.from(`${ZENI_API_KEY}:${ZENI_CONTRACT_KEY}`).toString("base64");

export const zenipointRequest = axios.create({
  baseURL: ZENI_API_URL,
  headers: {
    "Authorization": `Basic ${authHeader}`,
    "Content-Type": "application/json"
  },
  timeout: 15000,
});

/** Generate Reference */
export const generateReference = () =>
  String(Math.floor(10000000 + Math.random() * 90000000)) +
  Date.now() +
  Math.floor(Math.random() * 99999);
