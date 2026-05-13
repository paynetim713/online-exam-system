import { useState } from 'react'
import { FACE_MATCH_THRESHOLD, computeVisualSimilarity } from '../faceSimilarity'
import { useCamera } from '../hooks/useCamera'
import type { ExamRecord } from '../types'
import { formatDate } from '../utils'

const PRE_EXAM_DOS = [
  'Use a stable network, charged device, and quiet environment.',
  'Enable your camera on this page to complete the one-time face verification before the exam.',
  'Stay in fullscreen and answer questions independently after the exam begins.',
]

const PRE_EXAM_DONTS = [
  'Do not switch tabs, share screens, or use remote-control tools.',
  'Do not copy, paste, refresh, or connect additional devices during the exam.',
  'Do not ask others to answer for you or assist you during the exam.',
]

const PRE_EXAM_CONSEQUENCES = [
  'Suspicious behaviour can trigger warnings and a higher composite risk score.',
  'High-risk sessions may trigger a temporary face re-verification or Face + OTP checkpoint.',
  'Serious or repeated violations may freeze the session for invigilator review.',
]

interface VerificationPageProps {
  exam: ExamRecord
  candidateName: string
  referencePhoto: string | null
  onBack: () => void
  onVerify: (imageData: string, clientSimilarity?: number, clientPassed?: boolean) => Promise<{ passed: boolean; similarity: number; error?: string }>
  onEnterExam: () => Promise<void> | void
  verified: boolean
  error?: string
  onDismissError?: () => void
}

export function VerificationPage({
  exam,
  candidateName,
  referencePhoto,
  onBack,
  onVerify,
  onEnterExam,
  verified,
  error,
  onDismissError,
}: VerificationPageProps) {
  const { videoRef, cameraReady, cameraError, startCamera, captureFrame } = useCamera(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(
    verified ? 'Identity verified successfully.' : 'Enable the webcam to begin verification.',
  )
  const [similarity, setSimilarity] = useState<number | null>(null)
  const [passed, setPassed] = useState(verified)
  const [rulesAccepted, setRulesAccepted] = useState(false)
  const [consequencesAccepted, setConsequencesAccepted] = useState(false)

  const readyToEnter = passed && rulesAccepted && consequencesAccepted

  async function handleVerify() {
    const frame = captureFrame()
    if (!frame) {
      setStatus('Camera image is not ready yet.')
      return
    }
    if (!referencePhoto) {
      setStatus('No reference photo on file. Contact your administrator.')
      return
    }

    setBusy(true)
    const clientSimilarity = await computeVisualSimilarity(referencePhoto, frame)
    const clientPassed = clientSimilarity >= FACE_MATCH_THRESHOLD
    const response = await onVerify(frame, clientSimilarity, clientPassed)
    setBusy(false)
    if (response.error) {
      setStatus(response.error)
      return
    }
    setPassed(response.passed)
    setSimilarity(response.similarity)
    setStatus(
      response.passed
        ? 'Identity verified successfully.'
        : `Verification failed (${response.similarity}% < ${FACE_MATCH_THRESHOLD}%). Ensure your face is clearly visible, well-lit, and centred in the frame.`,
    )
  }

  return (
    <div className="verify-page">
      <button className="back-link" onClick={onBack}>Back to home</button>

      {error && (
        <div className="top-notice top-notice-error">
          <span>{error}</span>
          {onDismissError && <button className="text-link" onClick={onDismissError}>Dismiss</button>}
        </div>
      )}

      <div className="verify-panel">
        <div className="verify-camera">
          <div className="compare-frames">
            <div className="compare-slot">
              <div className="compare-label">Registered Photo</div>
              <div className="camera-frame">
                {referencePhoto ? (
                  <img src={referencePhoto} alt="Registration reference" className="reference-photo" />
                ) : (
                  <div className="camera-overlay no-ref-photo">
                    No reference photo on file.
                    <br />
                    Contact your administrator.
                  </div>
                )}
              </div>
            </div>
            <div className="compare-vs">vs</div>
            <div className="compare-slot">
              <div className="compare-label">Live Camera</div>
              <div className="camera-frame">
                <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
                {!cameraReady && <div className="camera-overlay">{cameraError || 'Starting webcam...'}</div>}
              </div>
            </div>
          </div>

          <div className="progress-caption">
            {status}
            {similarity !== null && (
              <span className={`verify-score ${passed ? 'verify-score-pass' : 'verify-score-fail'}`}>
                Face match: {similarity}% {passed ? 'Passed' : `Below threshold (${FACE_MATCH_THRESHOLD}%)`}
              </span>
            )}
          </div>

          <div className="verify-actions">
            <button className="secondary-button" onClick={() => void startCamera()}>Enable Camera</button>
            <button
              className="primary-button"
              onClick={() => void handleVerify()}
              disabled={busy || !cameraReady || !referencePhoto}
            >
              {busy ? 'Comparing...' : 'Verify Identity'}
            </button>
          </div>
        </div>

        <div className="verify-content">
          <span className="eyebrow">Identity verification</span>
          <h1>Welcome, {candidateName}</h1>
          <p>
            Your live photo will be compared against your registration record to confirm your
            identity before the exam starts. A face match score of <strong>&ge; {FACE_MATCH_THRESHOLD}%</strong>{' '}
            is required to proceed. Camera access is used for this pre-exam check and may be used
            again only if a later high-risk checkpoint requires temporary re-verification.
          </p>

          <div className="note-card">
            <strong>{exam.title}</strong>
            <span>{exam.subject}</span>
            <span>{exam.total_questions} questions, total score {exam.total_score} points</span>
            <span>Scheduled window: {formatDate(exam.start_time)} to {formatDate(exam.end_time)}</span>
          </div>

          <div className="briefing-grid">
            <div className="briefing-card briefing-card-do">
              <strong>Before You Start</strong>
              <ul className="check-list">
                {PRE_EXAM_DOS.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className="briefing-card briefing-card-dont">
              <strong>Do Not</strong>
              <ul className="check-list">
                {PRE_EXAM_DONTS.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className="briefing-card briefing-card-consequence">
              <strong>If You Break The Rules</strong>
              <ul className="check-list">
                {PRE_EXAM_CONSEQUENCES.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>

          <div className="consent-box">
            <label className="consent-row">
              <input
                type="checkbox"
                checked={rulesAccepted}
                onChange={(event) => setRulesAccepted(event.target.checked)}
              />
              <span>I understand the rules and what is prohibited during the exam.</span>
            </label>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consequencesAccepted}
                onChange={(event) => setConsequencesAccepted(event.target.checked)}
              />
              <span>I understand that violations may trigger additional face verification, Face + OTP, or session freeze.</span>
            </label>
          </div>

          <div className="verify-actions">
            <button className="secondary-button" onClick={onBack}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => void onEnterExam()}
              disabled={!readyToEnter}
            >
              Enter Examination
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
