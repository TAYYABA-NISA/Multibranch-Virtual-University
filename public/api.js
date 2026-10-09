// Every call to the backend goes through this one function.
//   USE_MOCK = false -> talks to the real backend (this page is served by it, so the address is empty)
//   USE_MOCK = true  -> fake backend inside the browser (mock.js), for working without a server
const USE_MOCK = false;
const API_URL = '';

async function api(path, body) {
  const token = localStorage.getItem('exam_token');
  let status, data;
  if (USE_MOCK) {
    ({ status, data } = await mockServer(path, body, token));
  } else {
    let res;
    try {
      res = await fetch(API_URL + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Cannot reach the server. Is the backend running?');
    }
    status = res.status;
    data = await res.json().catch(() => ({}));
  }
  if (status >= 400) {
    const error = new Error(data.error || 'Something went wrong');
    error.status = status;
    throw error;
  }
  return data;
}
