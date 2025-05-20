import React, { useRef, useState } from 'react';

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob, audioBase64: string) => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete }) => {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const startRecording = async () => {
    setAudioUrl(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new window.MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    audioChunks.current = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.current.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
      setAudioUrl(URL.createObjectURL(audioBlob));
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        onRecordingComplete(audioBlob, base64);
      };
      reader.readAsDataURL(audioBlob);
    };
    mediaRecorder.start();
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        {recording ? (
          <button onClick={stopRecording} style={{ padding: '8px 16px', background: '#d32f2f', color: '#fff', border: 'none', borderRadius: 6 }}>Stop Recording</button>
        ) : (
          <button onClick={startRecording} style={{ padding: '8px 16px', background: '#388e3c', color: '#fff', border: 'none', borderRadius: 6 }}>Start Recording</button>
        )}
      </div>
      {audioUrl && (
        <audio controls src={audioUrl} style={{ width: '100%' }} />
      )}
    </div>
  );
};

export default AudioRecorder; 