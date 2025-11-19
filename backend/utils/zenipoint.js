import axios from "axios";

const ZENI_API_URL = "https://api.zenipoint.com.ng/api"; // CORRECT

function getAuthHeader() {
  const key = process.env.ZENI_API_KEY;
  const contract = process.env.ZENI_CONTRACT_KEY;

  if (!key || !contract) {
    throw new Error("Zenipoint API credentials missing");
  }

  return `Basic ${Buffer.from(`${key}:${contract}`).toString("base64")}`;
}

export const zeniClient = axios.create({
  baseURL: ZENI_API_URL,
  timeout: 20000,
});

/* GET */
export const zenipointGet = async (path) => {
  return zeniClient.get(path, {
    headers: {
      Authorization: getAuthHeader(),
      Accept: "application/json",
    },
  });
};

/* POST */
export const zenipointPost = async (path, payload) => {
  return zeniClient.post(path, payload, {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
};

export const generateReference = () =>
  `BGG-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
