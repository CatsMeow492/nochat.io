import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallSettings } from '../context/provider';
import { CallIntent } from '../context/context';

const RedirectToJoin: React.FC = () => {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const { dispatch } = useCallSettings();

  useEffect(() => {
    const checkRoomStatus = async () => {
      try {
        // Check if the meeting has already started
        const response = await fetch(`/api/roomStatus?room_id=${roomId}`);
        const data = await response.json();
        
        if (data.status === "started") {
          // If meeting has started, go directly to the active call
          navigate(`/call/${roomId}/active`, { replace: true });
        } else {
          // If meeting hasn't started, set call intent to Join and redirect to join page
          dispatch({ type: "SET_CALL_INTENT", payload: CallIntent.Join });
          navigate('/join', { 
            replace: true,
            state: { roomId }
          });
        }
      } catch (error) {
        console.error('Error checking room status:', error);
        // On error, default to join page
        dispatch({ type: "SET_CALL_INTENT", payload: CallIntent.Join });
        navigate('/join', { 
          replace: true,
          state: { roomId }
        });
      }
    };

    checkRoomStatus();
  }, [navigate, roomId, dispatch]);

  return null;
};

export default RedirectToJoin; 