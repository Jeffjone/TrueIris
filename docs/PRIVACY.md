# Privacy inventory

## Current foundation

No camera, microphone, OS foreground application, window title, screenshot, physiological observation, journal entry, or user history is captured or persisted. Electron permissions are denied. The application calls only its configured API health endpoint. Credentials are optional and remain in main/backend process configuration; the renderer receives only validated status. Logs contain lifecycle/request metadata, not request bodies or raw media.

The settings page describes current inactive capabilities. Capture switches and deletion/retention controls will be added when the associated services exist.

## Planned integration inventory

| Information                           | Captured with                               | Persistence                                             | External destination                                                                  |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Webcam frames                         | Explicit camera consent                     | No raw-frame persistence                                | Verify Presage SDK transport/telemetry and disclose actual behavior before activation |
| Pulse, respiration, HRV, confidence   | Camera sensing enabled                      | About 1 Hz measurements and 30–60s epochs               | Authenticated API → Tiger Data                                                        |
| Foreground application and idle state | Desktop-context consent                     | Context intervals                                       | API → Tiger Data; bounded evidence to Gemini                                          |
| Window title                          | Additional opt-in                           | Optional context field with retention                   | May contain sensitive text; omit by default                                           |
| Screen image                          | Separate explicit opt-in with visible state | Transient; discard after classification                 | Gemini multimodal endpoint                                                            |
| Microphone audio                      | User starts listening                       | Transient, no raw-audio logging/storage                 | ElevenLabs realtime transcription                                                     |
| Questions and evidence                | User asks Iris                              | Conversation policy decided during agent implementation | Gemini; spoken response text to ElevenLabs                                            |
| Journals and session summaries        | User entry / enabled memory                 | Text, embeddings, metadata                              | Tiger Data; configured embedding/reasoning service                                    |
| Mock / seeded observations            | Explicit development/demo mode              | Marked source; isolated clear command                   | Never described as real user history                                                  |

Retention, export, delete, stop/pause, and consent enforcement are required before collecting relevant data. Stopping sensing must also stop SDK activity and future subscriptions. Logging must not serialize arbitrary provider events, prompts, screenshots, audio, or configuration objects. No scraping is planned.
