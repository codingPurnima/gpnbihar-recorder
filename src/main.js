
import { Room, RoomEvent, Track } from "livekit-client";
import "./style.css";
import EgressHelperImport from "@livekit/egress-sdk";

const EgressHelper =
  EgressHelperImport.default ?? EgressHelperImport;

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

  // The anchor gets the larger tile.
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
    EgressHelper.endRecording();
    recordingStarted = false;
  }
  // if (recordingStarted) {
  // console.log("END_RECORDING");
  // recordingStarted = false;
});

async function startStudio() {
  const url = EgressHelper.getLiveKitURL();
  const token = EgressHelper.getAccessToken();

  if (!url || !token) {
    connectionStatus.textContent =
      "Waiting for LiveKit recording parameters";
    console.info("Open this page through LiveKit Egress to supply its URL and token.");
    return;
  }

  try {
    connectionStatus.textContent = "Connecting to LiveKit...";

    await room.connect(url, token);
    EgressHelper.setRoom(room);

    registerParticipant(room.localParticipant);

    room.remoteParticipants.forEach((participant) => {
      registerParticipant(participant);
    });

    connectionStatus.textContent = "Studio connected";

    // Allow the browser time to paint the initial studio layout.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    EgressHelper.startRecording();
    recordingStarted = true;
    console.info("GPNBIHAR studio layout ready; recording signal sent.");
  } catch (error) {
    console.error("Could not start the recording template:", error);
    connectionStatus.textContent = "Connection failed — check logs";
  }
}

startStudio();