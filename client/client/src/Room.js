// src/Room.js
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import io from 'socket.io-client';

const SIGNALING_SERVER = 'http://localhost:5000'; // server from step 1
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function Room() {
  const { roomId } = useParams();
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState([]); // array of { id, stream }
  const peerConnections = useRef({}); // map peerId -> RTCPeerConnection
  const localStreamRef = useRef(null);

  useEffect(() => {
    // init socket
    socketRef.current = io(SIGNALING_SERVER, { transports: ['websocket'] });

    // get local media
    async function setupLocal() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        socketRef.current.emit('join-room', roomId);
      } catch (err) {
        console.error('Error accessing media devices.', err);
        alert('Camera/microphone access is required.');
      }
    }

    setupLocal();

    // when joining, server will send list of existing users
    socketRef.current.on('all-users', (users) => {
      // users = array of socket ids already in room -> create offer to each
      users.forEach(remoteId => {
        createPeerConnectionAndOffer(remoteId);
      });
    });

    // when a new user joins after you, you'll receive this
    socketRef.current.on('user-joined', (remoteId) => {
      // just prepare to accept offers from them later (no immediate action needed)
      console.log('user-joined', remoteId);
    });

    // incoming offer
    socketRef.current.on('offer', async ({ from, sdp }) => {
      console.log('Received offer from', from);
      await handleReceivedOffer(from, sdp);
    });

    // incoming answer
    socketRef.current.on('answer', async ({ from, sdp }) => {
      console.log('Received answer from', from);
      const pc = peerConnections.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    // incoming ICE candidate
    socketRef.current.on('ice-candidate', async ({ from, candidate }) => {
      const pc = peerConnections.current[from];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('Error adding received ice candidate', e);
        }
      }
    });

    // user left
    socketRef.current.on('user-left', (id) => {
      console.log('user-left', id);
      // remove video and close pc
      setRemoteStreams(prev => prev.filter(r => r.id !== id));
      if (peerConnections.current[id]) {
        peerConnections.current[id].close();
        delete peerConnections.current[id];
      }
    });

    return () => {
      // cleanup on leave/unmount
      if (socketRef.current) socketRef.current.disconnect();
      Object.values(peerConnections.current).forEach(pc => pc.close());
      peerConnections.current = {};
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // create RTCPeerConnection, add local tracks, create offer -> send to remote
  async function createPeerConnectionAndOffer(remoteId) {
    if (peerConnections.current[remoteId]) return;
    const pc = new RTCPeerConnection(ICE_CONFIG);
    peerConnections.current[remoteId] = pc;

    // add local tracks
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

    // ontrack -> add remote stream to UI
    pc.ontrack = (event) => {
      console.log('ontrack from', remoteId);
      const remoteStream = event.streams[0];
      setRemoteStreams(prev => {
        // avoid duplicates
        if (prev.find(r => r.id === remoteId)) return prev;
        return [...prev, { id: remoteId, stream: remoteStream }];
      });
    };

    // icecandidate -> send to remote
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', { to: remoteId, candidate: event.candidate });
      }
    };

    // create offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit('offer', { to: remoteId, sdp: pc.localDescription });
    } catch (err) {
      console.error('Error creating offer', err);
    }
  }

  // handle incoming offer: create pc, set remote desc, create answer
  async function handleReceivedOffer(fromId, sdp) {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    peerConnections.current[fromId] = pc;

    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setRemoteStreams(prev => {
        if (prev.find(r => r.id === fromId)) return prev;
        return [...prev, { id: fromId, stream: remoteStream }];
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', { to: fromId, candidate: event.candidate });
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('answer', { to: fromId, sdp: pc.localDescription });
    } catch (err) {
      console.error('Error handling offer', err);
    }
  }

  // UI handlers
  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Link copied to clipboard');
  };

  return (
    <div className="container py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>Room: <small className="text-muted">{roomId}</small></h4>
        <div>
          <button className="btn btn-outline-primary me-2" onClick={copyLink}>Copy Room Link</button>
        </div>
      </div>

      <div className="row">
        <div className="col-md-4 mb-3">
          <div className="card p-2">
            <div className="card-body">
              <h6>Your video</h6>
              <video ref={localVideoRef} autoPlay muted playsInline className="w-100 border rounded" />
            </div>
          </div>
        </div>

        <div className="col-md-8">
          <div className="card p-2">
            <div className="card-body">
              <h6>Remote videos</h6>
              <div className="d-flex flex-wrap">
                {remoteStreams.map(rs => (
                  <div key={rs.id} className="m-2" style={{ width: 240 }}>
                    <div className="border rounded">
                      <video
                        autoPlay
                        playsInline
                        ref={videoEl => {
                          if (videoEl && rs.stream) {
                            if (videoEl.srcObject !== rs.stream) videoEl.srcObject = rs.stream;
                          }
                        }}
                        className="w-100"
                      />
                    </div>
                    <div className="text-center small mt-1">peer: {rs.id.slice(0,6)}</div>
                  </div>
                ))}
                {remoteStreams.length === 0 && <div className="text-muted">No other users yet</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
