import { FlightLog } from "../../../vendor/log-core/flightlog.js";

let nextId = 1;

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}

export async function loadFlightSessionFromFile(file) {
  const bytes = await readFileAsArrayBuffer(file);
  const logData = new Uint8Array(bytes);
  const log = new FlightLog(logData);
  let selectedLogIndex = null;

  for (let index = 0; index < log.getLogCount(); index++) {
    if (!log.getLogError(index)) {
      selectedLogIndex = index;
      break;
    }
  }

  if (selectedLogIndex === null) {
    throw new Error("No readable log section was found in this file.");
  }

  if (!log.openLog(selectedLogIndex)) {
    throw new Error(`Failed to open log section #${selectedLogIndex + 1}.`);
  }

  return {
    id: `flight-${nextId++}`,
    name: file.name.replace(/\.[^.]+$/, ""),
    fileName: file.name,
    sourceFile: file,
    log,
    logIndex: selectedLogIndex,
    fieldNames: log.getMainFieldNames(),
    fieldIndex: log.getMainFieldIndexes(),
    minTimeUs: log.getMinTime(),
    maxTimeUs: log.getMaxTime(),
    durationUs: log.getMaxTime() - log.getMinTime(),
    numMotors: log.getNumMotors(),
    createdAt: Date.now(),
    video: null,
  };
}

export function createVideoAsset(file) {
  return {
    id: `video-${nextId++}`,
    fileName: file.name,
    file,
    url: URL.createObjectURL(file),
  };
}

export function disposeVideoAsset(video) {
  if (video?.url) {
    URL.revokeObjectURL(video.url);
  }
}
