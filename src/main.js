import { Room, RoomEvent, Track } from "livekit-client";
import "./style.css";
import EgressHelper from '@livekit/egress-sdk';

const anchorTile = document.getElementById("anchor-tile");
const guestGrid = document.getElementById("guest-grid");
const connectionStatus = document.getElementById("connection-status");

const ANCHOR_IDENTITY = "gpnbihar-anchor-poc";
const room = new Room({
  adaptiveStream: true,
  dynacast: true,
});

const participants = new Map();
let recordingStarted = false;

// Robust parameter extractor as a safeguard against Vite/CJS build bundling issues
function getEgressParams() {
  const params = new URLSearchParams(window.location.search);
  let url = params.get("url");
  let token = params.get("token");

  // Fallback to EgressHelper if available
  try {
    if (!url && typeof EgressHelper.getLiveKitURL === "function") {
      url = EgressHelper.getLiveKitURL();
    }
    if (!token && typeof EgressHelper.getAccessToken === "function") {
      token = EgressHelper.getAccessToken();
    }
  } catch (e) {
    console.warn("[template] EgressHelper methods unavailable, using URLSearchParams directly:", e);
  }

  return { url, token };
}

function makePlaceholder(message) {
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent = message;
  return placeholder;
}

function makeTile(participant, isAnchor) {
  const tile = document.createElement("div");
  tile.className = `video-tile ${isAnchor ? "anchor-tile" : "guest-tile"}`;
  tile.dataset.identity = participant.identity;

  const name = document.createElement("div");
  name.className = "participant-name";
  name.textContent = participant.identity === ANCHOR_IDENTITY
    ? "ANCHOR"
    : participant.identity;

  tile.appendChild(makePlaceholder("Camera is off"));
  tile.appendChild(name);

  return tile;
}

function getTile(participant) {
  return participants.get(participant.identity)?.tile;
}

function attachTrack(track, participant) {
  const tile = getTile(participant);
  if (!tile) return;

  if (track.kind === Track.Kind.Video) {
    tile.querySelector(".placeholder")?.remove();

    const video = track.attach();
    video.className = "participant-video";
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    tile.querySelector("video")?.remove();
    tile.prepend(video);
  }

  if (track.kind === Track.Kind.Audio) {
    const audio = track.attach();
    audio.autoplay = true;
    audio.dataset.identity = participant.identity;
    document.body.appendChild(audio);
    audio.play().catch(() => {});
  }
}

function detachTrack(track) {
  track.detach().forEach((element) => element.remove());
}

function renderParticipants() {
  const allParticipants = [
    room.localParticipant,
    ...room.remoteParticipants.values(),
  ];

  const anchor = allParticipants.find(
    (participant) => participant.identity === ANCHOR_IDENTITY
  );

  const guests = allParticipants.filter(
    (participant) =>
      participant.identity !== ANCHOR_IDENTITY &&
      participant.identity !== room.localParticipant.identity
  );

  anchorTile.replaceChildren();

  if (anchor) {
    const anchorInfo = participants.get(anchor.identity);
    if (anchorInfo) {
      anchorTile.appendChild(anchorInfo.tile);
    } else {
      anchorTile.appendChild(makePlaceholder("Waiting for anchor video..."));
    }
  } else {
    anchorTile.appendChild(makePlaceholder("Waiting for anchor..."));
  }

  guestGrid.replaceChildren();

  if (guests.length === 0) {
    guestGrid.appendChild(makePlaceholder("Waiting for guests..."));
  } else {
    guests.forEach((guest) => {
      const guestInfo = participants.get(guest.identity);
      if (guestInfo) guestGrid.appendChild(guestInfo.tile);
    });
  }
}

function registerParticipant(participant) {
  if (participants.has(participant.identity)) return;

  const isAnchor = participant.identity === ANCHOR_IDENTITY;
  const tile = makeTile(participant, isAnchor);

  participants.set(participant.identity, { tile });

  participant.trackPublications.forEach((publication) => {
    if (publication.track) {
      attachTrack(publication.track, participant);
    }
  });

  renderParticipants();
}

function removeParticipant(participant) {
  const info = participants.get(participant.identity);

  if (info) {
    info.tile.querySelectorAll("video").forEach((element) => element.remove());
    document
      .querySelectorAll(`audio[data-identity="${CSS.escape(participant.identity)}"]`)
      .forEach((element) => element.remove());

    participants.delete(participant.identity);
  }

  renderParticipants();
}

room.on(RoomEvent.ParticipantConnected, (participant) => {
  registerParticipant(participant);
});

room.on(RoomEvent.ParticipantDisconnected, (participant) => {
  removeParticipant(participant);
});

room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  registerParticipant(participant);
  attachTrack(track, participant);
});

room.on(RoomEvent.TrackUnsubscribed, (track) => {
  detachTrack(track);
});

room.on(RoomEvent.TrackPublished, (publication, participant) => {
  registerParticipant(participant);

  if (publication.track) {
    attachTrack(publication.track, participant);
  }
});

room.on(RoomEvent.TrackUnpublished, (publication) => {
  if (publication.track) {
    detachTrack(publication.track);
  }
});

room.on(RoomEvent.Disconnected, () => {
  connectionStatus.textContent = "Studio disconnected";

  if (recordingStarted) {
    try {
      if (typeof EgressHelper.endRecording === "function") {
        EgressHelper.endRecording();
      } else {
        console.log("END_RECORDING");
      }
    } catch (e) {
      console.log("END_RECORDING");
    }
    recordingStarted = false;
  }
});

async function startStudio() {
  try {
    const { url, token } = getEgressParams();

    console.info("[template] URL present:", Boolean(url));
    console.info("[template] Token present:", Boolean(token));

    if (!url || !token) {
      throw new Error("Missing LiveKit URL or recorder token in query string");
    }

    connectionStatus.textContent = "Connecting to LiveKit...";

    await room.connect(url, token);
    console.info("[template] Connected to room:", room.name);

    try {
      if (typeof EgressHelper.setRoom === "function") {
        EgressHelper.setRoom(room);
      }
    } catch (e) {
      console.warn("EgressHelper.setRoom failed:", e);
    }

    registerParticipant(room.localParticipant);
    room.remoteParticipants.forEach(registerParticipant);

    connectionStatus.textContent = "Studio connected";

    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    console.info("[egress-debug] Room connected:", room.state);
    console.info("[egress-debug] Layout rendered");

    // Signal start recording to move Egress worker from STARTING to ACTIVE
    try {
      if (typeof EgressHelper.startRecording === "function") {
        EgressHelper.startRecording();
      } else {
        console.log("START_RECORDING");
      }
    } catch (e) {
      console.log("START_RECORDING");
    }

    recordingStarted = true;
    connectionStatus.textContent = "Recording signal sent";

    console.info("[egress-debug] Recording signal successfully sent");

  } catch (error) {
    console.error("[template] Startup failed:", error);
    connectionStatus.textContent = "Connection failed — check logs";
  }
}

startStudio();