import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCallSettings } from '../context/provider';
import { CallIntent } from '../context/context';

const RedirectToJoin: React.FC = () => {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const { dispatch } = useCallSettings();

  useEffect(() => {
    // Set the call intent to Join
    dispatch({ type: "SET_CALL_INTENT", payload: CallIntent.Join });

    // Redirect to the join page with the room ID in state
    navigate('/join', { 
      replace: true,
      state: { roomId }
    });
  }, [navigate, roomId, dispatch]);

  return null;
};

export default RedirectToJoin; 