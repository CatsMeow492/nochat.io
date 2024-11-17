// @ts-nocheck // TODO: Remove
import React, { useState, useEffect, ChangeEvent, useRef } from "react";
import Webcam from "react-webcam";
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  SelectChangeEvent,
  TextField,
} from "@mui/material";
import {
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Videocam as VideocamIcon,
  VideocamOff as VideocamOffIcon,
} from "@mui/icons-material";
import Background from "../assets/static_background.png";
import PNGBackground from "../components/Background/static_background";
import ModernAppBar from "../components/appbar";
import { useNavigate } from "react-router-dom";
import { useCallSettings } from "../context/provider";
import { CallIntent, Device } from "../context/context";

enum CallReducerAction {}


/**
 * CallConfigurations Component
 *
 * This component provides a user interface for configuring call settings before
 * starting or joining a video call. It allows users to select their camera and
 * microphone, toggle video and audio, and enter a room ID for joining a call.
 *
 * Uses a global state managed by the CallSettingsContext to handle
 * device selection and call settings.
 */
const CallConfigurations: React.FC = () => {
  // Global state and dispatch function from CallSettingsContext
  // @ts-ignore - TODO: Remove this once types are properly set up in the context
  const { state, dispatch } = useCallSettings();

  // Local state for room ID input
  const [roomId, setRoomId] = useState<string>("");

  const webcamRef = useRef<Webcam>(null);

  const navigate = useNavigate();

  // initialize and set up media devices
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(
          (device) => device.kind === "videoinput"
        );
        const audioInputs = devices.filter(
          (device) => device.kind === "audioinput"
        );

        dispatch({
          type: "SET_VIDEO_DEVICES",
          payload: videoInputs.map((device) => ({
            deviceId: device.deviceId,
            label: device.label || `Camera ${videoInputs.indexOf(device) + 1}`,
          })),
        });

        dispatch({
          type: "SET_AUDIO_DEVICES",
          payload: audioInputs.map((device) => ({
            deviceId: device.deviceId,
            label:
              device.label || `Microphone ${audioInputs.indexOf(device) + 1}`,
          })),
        });

        if (videoInputs.length > 0)
          dispatch({
            type: "SET_SELECTED_VIDEO_DEVICE",
            payload: videoInputs[0].deviceId,
          });
        if (audioInputs.length > 0)
          dispatch({
            type: "SET_SELECTED_AUDIO_DEVICE",
            payload: audioInputs[0].deviceId,
          });
      } catch (error) {
        console.error("Error accessing media devices:", error);
      }
    };

    getDevices();
  }, [dispatch]);

  /**
   * Handler for video device selection change
   */
  const handleVideoDeviceChange = (event: SelectChangeEvent<string>) => {
    dispatch({
      type: "SET_SELECTED_VIDEO_DEVICE",
      payload: event.target.value,
    });
  };

  /**
   * Handler for audio device selection change
   */
  const handleAudioDeviceChange = (event: SelectChangeEvent<string>) => {
    dispatch({
      type: "SET_SELECTED_AUDIO_DEVICE",
      payload: event.target.value,
    });
  };

  /**
   * Handler for room ID input change
   */
  const handleRoomIdChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRoomId(event.target.value);
  };

  /**
   * Setup call based on the current call intent
   * TODO: Implement actual call setup logic
   */
  const setupCall = async (): Promise<{id: string }> => {
    let id: string;

    if (state.callIntent === CallIntent.Join) {
      // Handle join call logic
      dispatch({ type: "SET_ROOM_ID", payload: roomId });
      id = roomId;

    } else {
      // Handle start call logic
      const generatedRoomId = state.callIntent === CallIntent.Start 
      ? Math.random().toString(36).substring(7) 
      : roomId;

    
      dispatch({ type: "SET_ROOM_ID", payload: generatedRoomId });
      setRoomId(generatedRoomId)
      id = generatedRoomId;

    }

    if (!id) {
      throw new Error("Invalid Room Id")
    }

    return {id: id }
  };

  /**
   * Initiate the call and navigate to the call screen
   * TODO: Implement navigation to actual call screen
   */
  const startCall = async () => {
    // Generate a room ID if starting a new call
    const { id} = await setupCall()
    navigate(`/call/${id}`);
  };


  return (
    <Box component="div">
      <ModernAppBar />
      <PNGBackground imageSrc={Background} />
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "20px",
          gap: "20px",
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{
            color: "#eee",
            fontWeight: 300,
            textAlign: "center",
            maxWidth: "800px",
            margin: "0 auto",
            marginBottom: "24px",
            lineHeight: 1.6,
          }}
        >
          <Typography fontWeight="bold" component="span">
            Ready to connect?
          </Typography>{" "}
          Select your audio and video devices, adjust your settings, and click
          "Start Call" when you're all set. Ensure your mic and camera are
          working for the best experience.
        </Typography>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            maxWidth: "800px",
            gap: "20px",
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
              gap: "20px",
              backgroundColor: "rgba(0, 0, 0, 0.3)",
              borderRadius: "16px",
              padding: "30px",
            }}
          >
            <Box sx={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <Chip
                clickable
                onClick={() =>
                  dispatch({
                    type: "SET_CALL_INTENT",
                    payload: CallIntent.Start,
                  })
                }
                label="Start Call"
                color="primary"
                variant={
                  state.callIntent === CallIntent.Start ? "filled" : "outlined"
                }
                sx={{
                  fontSize: "1rem",
                  padding: "10px",
                  borderRadius: "25px",
                }}
              />
              <Chip
                onClick={() =>
                  dispatch({
                    type: "SET_CALL_INTENT",
                    payload: CallIntent.Join,
                  })
                }
                label="Join Call"
                color="primary"
                variant={
                  state.callIntent === CallIntent.Join ? "filled" : "outlined"
                }
                sx={{
                  fontSize: "1rem",
                  padding: "10px",
                  borderRadius: "25px",
                }}
              />
            </Box>

            <Box
              sx={{
                display: "flex",
                width: "100%",
                gap: "20px",
                marginBottom: "20px",
              }}
            >
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
                <FormControl fullWidth>
                  <InputLabel
                    sx={{ color: "white", "&.Mui-focused": { color: "white" } }}
                  >
                    Select Camera
                  </InputLabel>
                  <Select
                    variant="filled"
                    value={state.selectedVideoDevice}
                    onChange={handleVideoDeviceChange}
                    label="Select Camera"
                    sx={{
                      color: "white",
                      backgroundColor: "rgba(255, 255, 255, 0.1)",
                      "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.2)",
                      },
                      "&.Mui-focused": {
                        backgroundColor: "rgba(255, 255, 255, 0.2)",
                      },
                      "& .MuiFilledInput-input": { color: "white" },
                      "& .MuiSvgIcon-root": { color: "white" },
                      "&::before": { borderBottom: "none" },
                      "&::after": { borderBottom: "none" },
                      "&:hover:not(.Mui-disabled):before": {
                        borderBottom: "none",
                      },
                    }}
                  >
                    {state.videoDevices.map((device: Device) => (
                      <MenuItem key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel
                    sx={{ color: "white", "&.Mui-focused": { color: "white" } }}
                  >
                    Select Microphone
                  </InputLabel>
                  <Select
                    variant="filled"
                    value={state.selectedAudioDevice}
                    onChange={handleAudioDeviceChange}
                    label="Select Microphone"
                    sx={{
                      color: "white",
                      backgroundColor: "rgba(255, 255, 255, 0.1)",
                      "&:hover": {
                        backgroundColor: "rgba(255, 255, 255, 0.2)",
                      },
                      "&.Mui-focused": {
                        backgroundColor: "rgba(255, 255, 255, 0.2)",
                      },
                      "& .MuiFilledInput-input": { color: "white" },
                      "& .MuiSvgIcon-root": { color: "white" },
                      "&::before": { borderBottom: "none" },
                      "&::after": { borderBottom: "none" },
                      "&:hover:not(.Mui-disabled):before": {
                        borderBottom: "none",
                      },
                    }}
                  >
                    {state.audioDevices.map((device: Device) => (
                      <MenuItem key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {state.callIntent === CallIntent.Join && (
                  <FormControl fullWidth>
                    <TextField
                      variant="filled"
                      value={roomId}
                      onChange={handleRoomIdChange}
                      label="Enter a room id"
                      sx={{
                        color: "white",
                        backgroundColor: "rgba(255, 255, 255, 0.1)",
                        "&:hover": {
                          backgroundColor: "rgba(255, 255, 255, 0.2)",
                        },
                        "&.Mui-focused": {
                          backgroundColor: "rgba(255, 255, 255, 0.2)",
                        },
                        "& .MuiFilledInput-input": { color: "white" },
                        "& .MuiSvgIcon-root": { color: "white" },
                        "&::before": { borderBottom: "none" },
                        "&::after": { borderBottom: "none" },
                        "&:hover:not(.Mui-disabled):before": {
                          borderBottom: "none",
                        },
                      }}
                    />
                  </FormControl>
                )}
              </Box>

              <Box
                sx={{
                  flex: 1,
                  backgroundColor: "rgba(128, 128, 128, 0.3)",
                  borderRadius: "6px",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  maxHeight: "210px",
                  overflow: "hidden",
                }}
              >
                {state.isVideoOn ? (
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    videoConstraints={{ deviceId: state.selectedVideoDevice }}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <Typography variant="h6" sx={{ color: "white" }}>
                    Camera is off
                  </Typography>
                )}
              </Box>
            </Box>

            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-start",
                gap: "20px",
                marginBottom: "20px",
              }}
            >
              <Chip
                icon={state.isMuted ? <MicOffIcon /> : <MicIcon />}
                label={state.isMuted ? "Unmute" : "Mute"}
                onClick={() => dispatch({ type: "TOGGLE_MUTE" })}
                color={state.isMuted ? "default" : "primary"}
                variant="outlined"
                sx={{ padding: "0px 10px" }}
              />
              <Chip
                icon={state.isVideoOn ? <VideocamIcon /> : <VideocamOffIcon />}
                label={state.isVideoOn ? "Turn off camera" : "Turn on camera"}
                onClick={() => dispatch({ type: "TOGGLE_VIDEO" })}
                color={state.isVideoOn ? "primary" : "default"}
                variant="outlined"
                sx={{ padding: "0px 10px" }}
              />
            </Box>

            <Button
              disableElevation
              fullWidth
              size="large"
              sx={{ textTransform: "none" }}
              variant="contained"
              onClick={startCall}
            >
              {state.callIntent === CallIntent.Start
                ? "Start Lobby"
                : "Join Lobby"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default CallConfigurations;
