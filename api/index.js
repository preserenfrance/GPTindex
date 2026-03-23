import { handleRequest } from "../server.js";

export default async function handler(request, response) {
  await handleRequest(request, response);
}
