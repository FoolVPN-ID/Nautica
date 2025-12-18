import { connect } from "cloudflare:sockets";

// Variables
let serviceName = "";
let APP_DOMAIN = "";

let prxIP = "";
let cachedPrxList = [];
let cacheTimestamp = 0;
const CACHE_TTL = 3600000; // 1 hour in milliseconds

// Constant
const horse = "dHJvamFu";
const flash = "dm1lc3M=";
const v2 = "djJyYXk=";
const neko = "Y2xhc2g=";

// Pre-computed constants (optimization)
const PROTOCOL_HORSE = atob(horse);
const PROTOCOL_FLASH = atob(flash);
const PROTOCOL_V2 = atob(v2);
const PROTOCOL_NEKO = atob(neko);
const UUID_V4_REGEX = /^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i;

const PORTS = [443, 80];
const PROTOCOLS = [PROTOCOL_HORSE, PROTOCOL_FLASH, "ss"];
const SUB_PAGE_URL = "https://foolvpn.web.id/nautica";
const KV_PRX_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/kvProxyList.json";
const PRX_BANK_URL = "https://raw.githubusercontent.com/FoolVPN-ID/Nautica/refs/heads/main/proxyList.txt";
const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const RELAY_SERVER_UDP = {
  host: "udp-relay.hobihaus.space",
  port: 7300,
};
const PRX_HEALTH_CHECK_API = "https://id1.foolvpn.web.id/api/v1/check";
const CONVERTER_URL = "https://api.foolvpn.web.id/convert";
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// Connection timeout constants
const CONNECTION_TIMEOUT_MS = 25000; // 25 seconds
const MAX_CONFIGS_PER_REQUEST = 20; // Pagination limit

async function getKVPrxList(kvPrxUrl = KV_PRX_URL, env) {
  if (!kvPrxUrl) {
    throw new Error("No URL Provided!");
  }

  // Try KV cache first
  if (env?.KV_CACHE) {
    const cached = await env.KV_CACHE.get("kv_prx_list", "json");
    if (cached) {
      return cached;
    }
  }

  const kvPrx = await fetch(kvPrxUrl);
  if (kvPrx.status == 200) {
    const data = await kvPrx.json();
    
    // Cache for future requests
    if (env?.KV_CACHE) {
      await env.KV_CACHE.put("kv_prx_list", JSON.stringify(data), {
        expirationTtl: 3600, // 1 hour
      });
    }
    
    return data;
  } else {
    return {};
  }
}

async function getPrxListPaginated(prxBankUrl = PRX_BANK_URL, options = {}, env) {
  /**
   * Format: <IP>,<Port>,<Country ID>,<ORG>
   * Streaming parser with pagination support
   */
  if (!prxBankUrl) {
    throw new Error("No URL Provided!");
  }

  const {
    offset = 0,
    limit = MAX_CONFIGS_PER_REQUEST,
    filterCC = [],
  } = options;

  // Check in-memory cache with TTL
  const now = Date.now();
  if (cachedPrxList.length > 0 && (now - cacheTimestamp) < CACHE_TTL) {
    return paginateArray(cachedPrxList, offset, limit, filterCC);
  }

  // Try KV cache
  if (env?.KV_CACHE) {
    const cached = await env.KV_CACHE.get("prx_list", "json");
    if (cached) {
      cachedPrxList = cached;
      cacheTimestamp = now;
      return paginateArray(cachedPrxList, offset, limit, filterCC);
    }
  }

  // Fetch and parse (only if not cached)
  const prxBank = await fetch(prxBankUrl);
  if (prxBank.status == 200) {
    const text = (await prxBank.text()) || "";
    const prxString = text.split("\n").filter(Boolean);
    
    cachedPrxList = prxString
      .map((entry) => {
        const [prxIP, prxPort, country, org] = entry.split(",");
        return {
          prxIP: prxIP || "Unknown",
          prxPort: prxPort || "Unknown",
          country: country || "Unknown",
          org: org || "Unknown Org",
        };
      })
      .filter(Boolean);
    
    cacheTimestamp = now;

    // Store in KV for cross-request caching
    if (env?.KV_CACHE) {
      await env.KV_CACHE.put("prx_list", JSON.stringify(cachedPrxList), {
        expirationTtl: 3600, // 1 hour
      });
    }
  }

  return paginateArray(cachedPrxList, offset, limit, filterCC);
}

function paginateArray(array, offset, limit, filterCC) {
  let filtered = array;
  
  // Apply country filter
  if (filterCC.length > 0) {
    filtered = array.filter((prx) => filterCC.includes(prx.country));
  }
  
  // Shuffle for randomization
  shuffleArray(filtered);
  
  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    data: paginated,
    pagination: {
      offset,
      limit,
      total,
      hasMore: (offset + limit) < total,
      nextOffset: (offset + limit) < total ? offset + limit : null,
    },
  };
}

async function reverseWeb(request, target, targetPath) {
  const targetUrl = new URL(request.url);
  const targetChunk = target.split(":");

  targetUrl.hostname = targetChunk[0];
  targetUrl.port = targetChunk[1]?.toString() || "443";
  targetUrl.pathname = targetPath || targetUrl.pathname;

  const modifiedRequest = new Request(targetUrl, request);
  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host"));

  const response = await fetch(modifiedRequest);
  const newResponse = new Response(response.body, response);
  
  for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
    newResponse.headers.set(key, value);
  }
  newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");

  return newResponse;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      APP_DOMAIN = url.hostname;
      serviceName = APP_DOMAIN.split(".")[0];

      const upgradeHeader = request.headers.get("Upgrade");

      // Handle prx client
      if (upgradeHeader === "websocket") {
        const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);

        if (url.pathname.length == 3 || url.pathname.match(",")) {
          const prxKeys = url.pathname.replace("/", "").toUpperCase().split(",");
          const prxKey = prxKeys[Math.floor(Math.random() * prxKeys.length)];
          const kvPrx = await getKVPrxList(KV_PRX_URL, env);

          prxIP = kvPrx[prxKey][Math.floor(Math.random() * kvPrx[prxKey].length)];
          return await websocketHandler(request);
        } else if (prxMatch) {
          prxIP = prxMatch[1];
          return await websocketHandler(request);
        }
      }

      if (url.pathname.startsWith("/sub")) {
        return Response.redirect(SUB_PAGE_URL + `?host=${APP_DOMAIN}`, 301);
      } else if (url.pathname.startsWith("/check")) {
        const target = url.searchParams.get("target").split(":");
        
        // Use waitUntil for non-critical health checks
        const resultPromise = checkPrxHealth(target[0], target[1] || "443");
        
        const result = await Promise.race([
          resultPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Health check timeout")), 5000)
          ),
        ]).catch(err => ({ error: err.message }));

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            ...CORS_HEADER_OPTIONS,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300", // 5 min cache
          },
        });
      } else if (url.pathname.startsWith("/api/v1")) {
        const apiPath = url.pathname.replace("/api/v1", "");

        if (apiPath.startsWith("/sub")) {
          // CRITICAL OPTIMIZATION: Pagination support
          const offset = parseInt(url.searchParams.get("offset")) || 0;
          const filterCC = url.searchParams.get("cc")?.split(",") || [];
          const filterPort = url.searchParams.get("port")?.split(",") || PORTS;
          const filterVPN = url.searchParams.get("vpn")?.split(",") || PROTOCOLS;
          const filterLimit = Math.min(
            parseInt(url.searchParams.get("limit")) || MAX_CONFIGS_PER_REQUEST,
            MAX_CONFIGS_PER_REQUEST // Hard cap
          );
          const filterFormat = url.searchParams.get("format") || "raw";
          const fillerDomain = url.searchParams.get("domain") || APP_DOMAIN;

          const prxBankUrl = url.searchParams.get("prx-list") || env.PRX_BANK_URL || PRX_BANK_URL;
          
          // Get paginated proxy list
          const { data: prxList, pagination } = await getPrxListPaginated(
            prxBankUrl,
            { offset, limit: filterLimit, filterCC },
            env
          );

          const uuid = crypto.randomUUID();
          const result = [];
          
          // OPTIMIZATION: Single loop with early break
          let configCount = 0;
          for (const prx of prxList) {
            if (configCount >= filterLimit) break;
            
            const uri = new URL(`${PROTOCOL_HORSE}://${fillerDomain}`);
            uri.searchParams.set("encryption", "none");
            uri.searchParams.set("type", "ws");
            uri.searchParams.set("host", APP_DOMAIN);

            for (const port of filterPort) {
              if (configCount >= filterLimit) break;
              
              for (const protocol of filterVPN) {
                if (configCount >= filterLimit) break;

                uri.protocol = protocol;
                uri.port = port.toString();
                
                if (protocol == "ss") {
                  uri.username = btoa(`none:${uuid}`);
                  uri.searchParams.set(
                    "plugin",
                    `${PROTOCOL_V2}-plugin${port == 80 ? "" : ";tls"};mux=0;mode=websocket;path=/${prx.prxIP}-${
                      prx.prxPort
                    };host=${APP_DOMAIN}`
                  );
                } else {
                  uri.username = uuid;
                }

                uri.searchParams.set("security", port == 443 ? "tls" : "none");
                uri.searchParams.set("sni", port == 80 && protocol == PROTOCOL_FLASH ? "" : APP_DOMAIN);
                uri.searchParams.set("path", `/${prx.prxIP}-${prx.prxPort}`);

                uri.hash = `${configCount + 1} ${getFlagEmoji(prx.country)} ${prx.org} WS ${
                  port == 443 ? "TLS" : "NTLS"
                } [${serviceName}]`;
                
                result.push(uri.toString());
                configCount++;
              }
            }
          }

          let finalResult = "";
          const responseHeaders = {
            ...CORS_HEADER_OPTIONS,
            "X-Pagination-Offset": offset.toString(),
            "X-Pagination-Limit": filterLimit.toString(),
            "X-Pagination-Total": pagination.total.toString(),
            "X-Pagination-Has-More": pagination.hasMore.toString(),
          };

          if (pagination.nextOffset !== null) {
            responseHeaders["X-Pagination-Next-Offset"] = pagination.nextOffset.toString();
          }

          switch (filterFormat) {
            case "raw":
              finalResult = result.join("\n");
              responseHeaders["Cache-Control"] = "public, max-age=1800"; // 30 min
              break;
            case PROTOCOL_V2:
              finalResult = btoa(result.join("\n"));
              responseHeaders["Cache-Control"] = "public, max-age=1800";
              break;
            case PROTOCOL_NEKO:
            case "sfa":
            case "bfr":
              // OPTIMIZATION: Move converter to waitUntil if possible
              // For now, add timeout protection
              const converterPromise = fetch(CONVERTER_URL, {
                method: "POST",
                body: JSON.stringify({
                  url: result.join(","),
                  format: filterFormat,
                  template: "cf",
                }),
              });

              const res = await Promise.race([
                converterPromise,
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Converter timeout")), 8000)
                ),
              ]).catch(err => {
                return new Response(JSON.stringify({ error: "Converter service timeout" }), {
                  status: 504,
                  headers: { ...CORS_HEADER_OPTIONS },
                });
              });

              if (res.status == 200) {
                finalResult = await res.text();
                responseHeaders["Cache-Control"] = "public, max-age=1800";
              } else {
                return new Response(res.statusText, {
                  status: res.status,
                  headers: { ...CORS_HEADER_OPTIONS },
                });
              }
              break;
          }

          return new Response(finalResult, {
            status: 200,
            headers: responseHeaders,
          });
        } else if (apiPath.startsWith("/myip")) {
          return new Response(
            JSON.stringify({
              ip:
                request.headers.get("cf-connecting-ipv6") ||
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-real-ip"),
              colo: request.headers.get("cf-ray")?.split("-")[1],
              ...request.cf,
            }),
            {
              headers: {
                ...CORS_HEADER_OPTIONS,
                "Cache-Control": "private, max-age=60",
              },
            }
          );
        }
      }

      const targetReversePrx = env.REVERSE_PRX_TARGET || "example.com";
      return await reverseWeb(request, targetReversePrx);
    } catch (err) {
      console.error("Worker error:", err);
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
        headers: {
          ...CORS_HEADER_OPTIONS,
        },
      });
    }
  },
};

async function websocketHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = {
    value: null,
  };
  let isDNS = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS) {
            return handleUDPOutbound(
              DNS_SERVER_ADDRESS,
              DNS_SERVER_PORT,
              chunk,
              webSocket,
              null,
              log,
              RELAY_SERVER_UDP
            );
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const protocol = await protocolSniffer(chunk);
          let protocolHeader;

          if (protocol === PROTOCOL_HORSE) {
            protocolHeader = readHorseHeader(chunk);
          } else if (protocol === PROTOCOL_FLASH) {
            protocolHeader = readFlashHeader(chunk);
          } else if (protocol === "ss") {
            protocolHeader = readSsHeader(chunk);
          } else {
            throw new Error("Unknown Protocol!");
          }

          addressLog = protocolHeader.addressRemote;
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message);
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
              return handleUDPOutbound(
                DNS_SERVER_ADDRESS,
                DNS_SERVER_PORT,
                chunk,
                webSocket,
                protocolHeader.version,
                log,
                RELAY_SERVER_UDP
              );
            }

            return handleUDPOutbound(
              protocolHeader.addressRemote,
              protocolHeader.portRemote,
              chunk,
              webSocket,
              protocolHeader.version,
              log,
              RELAY_SERVER_UDP
            );
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            protocolHeader.version,
            log
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
      })
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const horseDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (horseDelimiter[0] === 0x0d && horseDelimiter[1] === 0x0a) {
      if (horseDelimiter[2] === 0x01 || horseDelimiter[2] === 0x03 || horseDelimiter[2] === 0x7f) {
        if (horseDelimiter[3] === 0x01 || horseDelimiter[3] === 0x03 || horseDelimiter[3] === 0x04) {
          return PROTOCOL_HORSE;
        }
      }
    }
  }

  const flashDelimiter = new Uint8Array(buffer.slice(1, 17));
  // OPTIMIZATION: Use pre-compiled regex
  if (UUID_V4_REGEX.test(arrayBufferToHex(flashDelimiter))) {
    return PROTOCOL_FLASH;
  }

  return "ss"; // default
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log
) {
  async function connectAndWrite(address, port) {
    // CRITICAL: Add connection timeout
    const connectPromise = new Promise(async (resolve, reject) => {
      try {
        const tcpSocket = connect({
          hostname: address,
          port: port,
        });
        remoteSocket.value = tcpSocket;
        log(`connected to ${address}:${port}`);
        const writer = tcpSocket.writable.getWriter();
        await writer.write(rawClientData);
        writer.releaseLock();
        resolve(tcpSocket);
      } catch (err) {
        reject(err);
      }
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connection timeout")), CONNECTION_TIMEOUT_MS)
    );

    return Promise.race([connectPromise, timeoutPromise]);
  }

  async function retry() {
    try {
      const tcpSocket = await connectAndWrite(
        prxIP.split(/[:=-]/)[0] || addressRemote,
        prxIP.split(/[:=-]/)[1] || portRemote
      );
      tcpSocket.closed
        .catch((error) => {
          console.log("retry tcpSocket closed error", error);
        })
        .finally(() => {
          safeCloseWebSocket(webSocket);
        });
      remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
    } catch (err) {
      log("Retry failed", err.message);
      safeCloseWebSocket(webSocket);
    }
  }

  try {
    const tcpSocket = await connectAndWrite(addressRemote, portRemote);
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
  } catch (err) {
    log("TCP connection failed", err.message);
    safeCloseWebSocket(webSocket);
  }
}

async function handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log, relay) {
  try {
    let protocolHeader = responseHeader;

    // CRITICAL: Add timeout for UDP relay connection
    const connectPromise = new Promise(async (resolve, reject) => {
      try {
        const tcpSocket = connect({
          hostname: relay.host,
          port: relay.port,
        });

        const header = `udp:${targetAddress}:${targetPort}`;
        const headerBuffer = new TextEncoder().encode(header);
        const separator = new Uint8Array([0x7c]);
        const relayMessage = new Uint8Array(headerBuffer.length + separator.length + dataChunk.byteLength);
        relayMessage.set(headerBuffer, 0);
        relayMessage.set(separator, headerBuffer.length);
        relayMessage.set(new Uint8Array(dataChunk), headerBuffer.length + separator.length);

        const writer = tcpSocket.writable.getWriter();
        await writer.write(relayMessage);
        writer.releaseLock();

        resolve(tcpSocket);
      } catch (err) {
        reject(err);
      }
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("UDP relay timeout")), CONNECTION_TIMEOUT_MS)
    );

    const tcpSocket = await Promise.race([connectPromise, timeoutPromise]);

    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            if (protocolHeader) {
              webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer());
              protocolHeader = null;
            } else {
              webSocket.send(chunk);
            }
          }
        },
        close() {
          log(`UDP connection to ${targetAddress} closed`);
        },
        abort(reason) {
          console.error(`UDP connection aborted due to ${reason}`);
        },
      })
    );
  } catch (e) {
    console.error(`Error while handling UDP outbound: ${e.message}`);
    safeCloseWebSocket(webSocket);
  }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

function readSsHeader(ssBuffer) {
  const view = new DataView(ssBuffer);

  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `Invalid addressType for SS: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function readFlashHeader(buffer) {
  const version = new Uint8Array(buffer.slice(0, 1));
  let isUDP = false;

  const optLength = new Uint8Array(buffer.slice(17, 18))[0];

  const cmd = new Uint8Array(buffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not supported`,
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = buffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1));

  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2:
      addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3:
      addressLength = 16;
      const dataView = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`,
      };
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: buffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  };
}

function readHorseHeader(buffer) {
  const dataBuffer = buffer.slice(58);
  if (dataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid request data",
    };
  }

  let isUDP = false;
  const view = new DataView(dataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) {
    isUDP = true;
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!");
  }

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";
  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = dataBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: dataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  };
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader;
  let hasIncomingData = false;
  
  // CRITICAL: Add timeout for socket read operations
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Socket read timeout")), CONNECTION_TIMEOUT_MS)
  );

  try {
    await Promise.race([
      remoteSocket.readable.pipeTo(
        new WritableStream({
          start() {},
          async write(chunk, controller) {
            hasIncomingData = true;
            if (webSocket.readyState !== WS_READY_STATE_OPEN) {
              controller.error("webSocket.readyState is not open, maybe close");
            }
            if (header) {
              webSocket.send(await new Blob([header, chunk]).arrayBuffer());
              header = null;
            } else {
              webSocket.send(chunk);
            }
          },
          close() {
            log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
          },
          abort(reason) {
            console.error(`remoteConnection!.readable abort`, reason);
          },
        })
      ),
      timeoutPromise,
    ]);
  } catch (error) {
    console.error(`remoteSocketToWS has exception`, error.stack || error);
    safeCloseWebSocket(webSocket);
  }

  if (hasIncomingData === false && retry) {
    log(`retry`);
    retry();
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}

async function checkPrxHealth(prxIP, prxPort) {
  const req = await fetch(`${PRX_HEALTH_CHECK_API}?ip=${prxIP}:${prxPort}`);
  return await req.json();
}

// Helpers
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function shuffleArray(array) {
  let currentIndex = array.length;
  while (currentIndex != 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
}

function getFlagEmoji(isoCode) {
  const codePoints = isoCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
