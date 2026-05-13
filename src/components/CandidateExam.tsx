import { useEffect, useRef, useState } from 'react'
import { FACE_MATCH_THRESHOLD, computeVisualSimilarity } from '../faceSimilarity'
import { useCamera } from '../hooks/useCamera'
import type { CandidateSession, ExamRecord, QuestionRecord, RiskConfig } from '../types'
import { formatCountdown, getRiskTone } from '../utils'

const MAX_STEP_UP = 3

interface StepUpModalProps {
  method: RiskConfig['step_up_method']
  referencePhoto: string | null
  stepUpCode: string | null
  stepUpCount: number
  onRiskEvent: (type: string, note?: string, meta?: Record<string, unknown>) => Promise<void> | void
  onVerifyFace: (imageData: string, clientSimilarity?: number, clientPassed?: boolean) => Promise<{ passed: boolean; similarity: number; stepUpCodeHint?: string | null }>
  onComplete: (passed: boolean, method: string, otpCode?: string) => Promise<void> | void
}

function StepUpModal({
  method,
  referencePhoto,
  stepUpCode,
  stepUpCount,
  onRiskEvent,
  onVerifyFace,
  onComplete,
}: StepUpModalProps) {
  const attemptsUsed = stepUpCount
  const attemptsLeft = MAX_STEP_UP - attemptsUsed
  const [stage, setStage] = useState<'notice' | 'face' | 'otp' | 'frozen'>('notice')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Open your camera to complete the temporary identity check.')
  const [similarity, setSimilarity] = useState<number | null>(null)
  const [serverOtpCode, setServerOtpCode] = useState<string | null>(stepUpCode)
  const [otpValue, setOtpValue] = useState('')
  const cameraRiskReportedRef = useRef(false)
  const { videoRef, cameraReady, cameraError, startCamera, captureFrame } = useCamera(stage === 'face')

  useEffect(() => {
    setServerOtpCode(stepUpCode)
  }, [stepUpCode])

  useEffect(() => {
    if (!cameraError || cameraRiskReportedRef.current) return
    cameraRiskReportedRef.current = true
    void onRiskEvent(
      'webcam_interrupt',
      'Temporary camera access failed during step-up verification.',
      { method, stage: 'step_up' },
    )
  }, [cameraError, method, onRiskEvent])

  async function freezeSession() {
    setBusy(true)
    setStage('frozen')
    await onComplete(false, method)
    setBusy(false)
  }

  async function submitFaceVerification() {
    if (!referencePhoto) {
      setStatus('No reference photo is available. Please contact the administrator.')
      return
    }

    const frame = captureFrame()
    if (!frame) {
      setStatus('Camera image is not ready yet. Please wait a moment and try again.')
      if (!cameraRiskReportedRef.current) {
        cameraRiskReportedRef.current = true
        await onRiskEvent(
          'webcam_interrupt',
          'Temporary camera capture failed during step-up verification.',
          { method, stage: 'step_up' },
        )
      }
      return
    }

    setBusy(true)
    const clientSimilarity = await computeVisualSimilarity(referencePhoto, frame)
    const clientPassed = clientSimilarity >= FACE_MATCH_THRESHOLD
    const response = await onVerifyFace(frame, clientSimilarity, clientPassed)
    setBusy(false)
    setSimilarity(response.similarity)

    if (!response.passed) {
      setStatus(
        `Face match ${response.similarity}% is below the ${FACE_MATCH_THRESHOLD}% threshold. The session will be frozen for invigilator review.`,
      )
      setStage('frozen')
      await onComplete(false, method)
      return
    }

    if (method === 'Face Re-Verification') {
      setStatus('Identity re-verification passed. Returning you to the exam.')
      await onComplete(true, method)
      return
    }

    setServerOtpCode(response.stepUpCodeHint ?? stepUpCode)
    setStatus('Face re-verification passed. Enter the one-time code shown below to continue.')
    setStage('otp')
  }

  async function submitOtp() {
    setBusy(true)
    const passed = otpValue.trim() === (serverOtpCode ?? '')
    if (!passed) {
      setStage('frozen')
    }
    await onComplete(passed, method, otpValue.trim())
    setBusy(false)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card step-up-modal">
        <div className="step-up-header">
          <div className="step-up-badge">Identity Check</div>
          <h3>High-Risk Activity Detected</h3>
        </div>

        {stage === 'notice' && (
          <>
            <p>
              Your session risk has entered the high-risk range. To continue, complete the
              temporary additional verification step configured for this exam. This checkpoint uses
              a fresh identity capture before you can continue.
            </p>
            <div className={`step-up-attempts ${attemptsLeft <= 1 ? 'step-up-attempts-danger' : attemptsLeft <= 2 ? 'step-up-attempts-warn' : ''}`}>
              Verification {attemptsUsed + 1} of {MAX_STEP_UP} — {attemptsLeft === 1 ? 'Last attempt: failure will freeze this session.' : `${attemptsLeft} verifications remaining before auto-freeze.`}
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => void freezeSession()} disabled={busy}>
                Freeze My Session
              </button>
              <button
                className="primary-button"
                onClick={() => setStage('face')}
                disabled={busy}
              >
                {method === 'Face + OTP' ? 'Start Face + OTP Check' : 'Start Face Re-Verification'}
              </button>
            </div>
          </>
        )}

        {stage === 'face' && (
          <>
            <div className="compare-frames">
              <div className="compare-slot">
                <div className="compare-label">Registered Photo</div>
                <div className="camera-frame camera-frame-modal">
                  {referencePhoto ? (
                    <img src={referencePhoto} alt="Registration reference" className="reference-photo" />
                  ) : (
                    <div className="camera-overlay no-ref-photo">
                      No reference photo on file.
                    </div>
                  )}
                </div>
              </div>
              <div className="compare-vs">vs</div>
              <div className="compare-slot">
                <div className="compare-label">Live Camera</div>
                <div className="camera-frame camera-frame-modal">
                  <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
                  {!cameraReady && (
                    <div className="camera-overlay">
                      {cameraError || 'Starting the temporary verification camera...'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="progress-caption">
              {status}
              {similarity !== null && (
                <span className={`verify-score ${similarity >= FACE_MATCH_THRESHOLD ? 'verify-score-pass' : 'verify-score-fail'}`}>
                  Face match: {similarity}% {similarity >= FACE_MATCH_THRESHOLD ? 'Passed' : 'Below threshold'}
                </span>
              )}
            </div>

            <div className="modal-actions">
              <button className="secondary-button" onClick={() => void startCamera()} disabled={busy}>
                Enable Camera
              </button>
              <button
                className="primary-button"
                onClick={() => void submitFaceVerification()}
                disabled={busy || !cameraReady || !referencePhoto}
              >
                {busy ? 'Comparing...' : 'Verify Identity'}
              </button>
            </div>
          </>
        )}

        {stage === 'otp' && (
          <>
            <p>
              Complete the second factor to finish the step-up check. You have one attempt. A wrong
              code will freeze the session for invigilator review.
            </p>
            <div className="otp-display-box">
              <span className="otp-display-label">One-time code (demo)</span>
              <span className="otp-display-code">{serverOtpCode ?? 'Awaiting code...'}</span>
            </div>
            <input
              className="otp-input"
              value={otpValue}
              onChange={(event) => setOtpValue(event.target.value)}
              placeholder="Enter code exactly as shown"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && otpValue.trim()) {
                  void submitOtp()
                }
              }}
            />
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => void submitOtp()}
                disabled={busy || otpValue.trim() === ''}
              >
                Submit Code
              </button>
            </div>
          </>
        )}

        {stage === 'frozen' && (
          <div className="step-up-frozen">
            <div className="frozen-icon-ring" />
            <div className="inline-alert inline-alert-danger">
              Additional verification failed. Your session has been frozen and reported.
            </div>
            <p>
              Please remain at your desk and wait for the invigilator to review the session.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

interface CandidateExamProps {
  exam: ExamRecord
  session: CandidateSession
  questions: QuestionRecord[]
  answers: Record<string, string>
  config: RiskConfig
  referencePhoto: string | null
  pageError: string
  onAnswerChange: (questionId: string, value: string) => void
  onRiskEvent: (type: string, note?: string, meta?: Record<string, unknown>) => Promise<void> | void
  onSubmit: () => Promise<void> | void
  onBackToDashboard: () => void
  onVerifyStepUpFace: (imageData: string, clientSimilarity?: number, clientPassed?: boolean) => Promise<{ passed: boolean; similarity: number; stepUpCodeHint?: string | null }>
  onCompleteStepUp: (passed: boolean, method: string, otpCode?: string) => Promise<void> | void
  onDismissError: () => void
}

export function CandidateExam({
  exam,
  session,
  questions,
  answers,
  config,
  referencePhoto,
  pageError,
  onAnswerChange,
  onRiskEvent,
  onSubmit,
  onBackToDashboard,
  onVerifyStepUpFace,
  onCompleteStepUp,
  onDismissError,
}: CandidateExamProps) {
  const [activeQuestionId, setActiveQuestionId] = useState(questions[0]?.id ?? '')
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [displayRemaining, setDisplayRemaining] = useState(session.remaining_seconds)
  const [fullscreenActive, setFullscreenActive] = useState(Boolean(document.fullscreenElement))
  const [fullscreenGraceCountdown, setFullscreenGraceCountdown] = useState<number | null>(null)

  const lastEventRef = useRef<Record<string, number>>({})
  const idleStateRef = useRef(false)
  const lastInteractionRef = useRef(0)
  const fullscreenExitTimerRef = useRef<number | null>(null)
  const fullscreenGraceIntervalRef = useRef<number | null>(null)
  // Stable ref so event handlers always call the latest callback without being
  // in the useEffect dep array (which would re-run the effect on every poll cycle).
  const onRiskEventRef = useRef(onRiskEvent)
  useEffect(() => { onRiskEventRef.current = onRiskEvent }, [onRiskEvent])

  useEffect(() => {
    lastInteractionRef.current = Date.now()
    if (!document.fullscreenElement && !session.frozen && session.status !== 'Completed') {
      // Suppress events that fire during fullscreen transition (resize → device_change, blur → blur_focus)
      lastEventRef.current['blur_focus'] = Date.now()
      lastEventRef.current['tab_switch'] = Date.now()
      lastEventRef.current['device_change'] = Date.now()
      void document.documentElement.requestFullscreen().catch(() => undefined)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDisplayRemaining(session.remaining_seconds)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [session.remaining_seconds])

  useEffect(() => {
    if (session.status === 'Completed') return
    const timer = window.setInterval(() => {
      setDisplayRemaining((current) => Math.max(current - 1, 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [session.status])

  useEffect(() => {
    if (displayRemaining === 0 && session.status !== 'Completed') {
      void onSubmit()
    }
  }, [displayRemaining, onSubmit, session.status])

  function recordUserInteraction() {
    lastInteractionRef.current = Date.now()
    if (idleStateRef.current) {
      idleStateRef.current = false
    }
  }

  useEffect(() => {
    function allowEvent(type: string) {
      if (session.verification_required || session.frozen) return false
      const last = lastEventRef.current[type] ?? 0
      if (Date.now() - last < 1800) return false
      lastEventRef.current[type] = Date.now()
      return true
    }

    function handleVisibilityChange() {
      if (document.hidden && allowEvent('tab_switch')) {
        void onRiskEventRef.current('tab_switch', 'The candidate switched away from the exam window.')
      }
    }

    function handleBlur() {
      if (!document.hidden && allowEvent('blur_focus')) {
        void onRiskEventRef.current('blur_focus', 'The exam window lost focus.')
      }
    }

    function handleCopyPaste(event: ClipboardEvent) {
      event.preventDefault()
      if (allowEvent('copy_paste')) {
        void onRiskEventRef.current('copy_paste', 'Copy and paste is blocked during the exam.')
      }
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      recordUserInteraction()
      if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')) {
        event.preventDefault()
        if (allowEvent('page_refresh')) {
          void onRiskEventRef.current('page_refresh', 'Refresh shortcuts are blocked during the exam.')
        }
      }
    }

    function handleResize() {
      if (allowEvent('device_change')) {
        void onRiskEventRef.current('device_change', 'The display or device context changed.')
      }
    }

    function handleOnlineChange() {
      if (allowEvent('network_reconnect')) {
        void onRiskEventRef.current('network_reconnect', 'Network connectivity changed during the exam.')
      }
    }

    function handleFullscreenChange() {
      const isNowFullscreen = Boolean(document.fullscreenElement)
      setFullscreenActive(isNowFullscreen)

      if (!isNowFullscreen) {
        // Suppress resize/blur events fired by the browser during fullscreen exit —
        // they would add device_change / blur_focus points before the grace period even starts.
        lastEventRef.current['device_change'] = Date.now()
        lastEventRef.current['blur_focus'] = Date.now()
        // Give student 5 seconds to re-enter fullscreen before recording the event
        const GRACE = 5
        setFullscreenGraceCountdown(GRACE)
        if (fullscreenGraceIntervalRef.current) window.clearInterval(fullscreenGraceIntervalRef.current)
        fullscreenGraceIntervalRef.current = window.setInterval(() => {
          setFullscreenGraceCountdown((n) => {
            if (n === null || n <= 1) {
              window.clearInterval(fullscreenGraceIntervalRef.current!)
              fullscreenGraceIntervalRef.current = null
              return null
            }
            return n - 1
          })
        }, 1000)
        if (fullscreenExitTimerRef.current) window.clearTimeout(fullscreenExitTimerRef.current)
        fullscreenExitTimerRef.current = window.setTimeout(() => {
          fullscreenExitTimerRef.current = null
          if (allowEvent('fullscreen_exit')) {
            void onRiskEventRef.current('fullscreen_exit', 'Fullscreen mode was exited.')
          }
        }, GRACE * 1000)
      } else {
        // Re-entered fullscreen in time — cancel the pending penalty
        if (fullscreenExitTimerRef.current) {
          window.clearTimeout(fullscreenExitTimerRef.current)
          fullscreenExitTimerRef.current = null
        }
        if (fullscreenGraceIntervalRef.current) {
          window.clearInterval(fullscreenGraceIntervalRef.current)
          fullscreenGraceIntervalRef.current = null
        }
        setFullscreenGraceCountdown(null)
        // Suppress blur/resize events from fullscreen re-entry transition
        lastEventRef.current['blur_focus'] = Date.now()
        lastEventRef.current['device_change'] = Date.now()
      }
    }

    const idleTimer = window.setInterval(() => {
      if (
        !idleStateRef.current &&
        Date.now() - lastInteractionRef.current >= config.idle_timeout_sec * 1000
      ) {
        idleStateRef.current = true
        void onRiskEventRef.current(
          'blur_focus',
          'No recent activity was detected for the configured idle-timeout window.',
        )
      }
    }, 1000)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('paste', handleCopyPaste)
    document.addEventListener('copy', handleCopyPaste)
    document.addEventListener('keydown', handleGlobalKeyDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('online', handleOnlineChange)
    window.addEventListener('offline', handleOnlineChange)
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    window.addEventListener('mousemove', recordUserInteraction)
    window.addEventListener('mousedown', recordUserInteraction)

    return () => {
      window.clearInterval(idleTimer)
      if (fullscreenExitTimerRef.current) window.clearTimeout(fullscreenExitTimerRef.current)
      if (fullscreenGraceIntervalRef.current) window.clearInterval(fullscreenGraceIntervalRef.current)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('paste', handleCopyPaste)
      document.removeEventListener('copy', handleCopyPaste)
      document.removeEventListener('keydown', handleGlobalKeyDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('online', handleOnlineChange)
      window.removeEventListener('offline', handleOnlineChange)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      window.removeEventListener('mousemove', recordUserInteraction)
      window.removeEventListener('mousedown', recordUserInteraction)
    }
  }, [config.idle_timeout_sec, session.frozen, session.verification_required])

  async function enableFullscreen() {
    try {
      lastEventRef.current['blur_focus'] = Date.now()
      lastEventRef.current['tab_switch'] = Date.now()
      lastEventRef.current['device_change'] = Date.now()
      await document.documentElement.requestFullscreen()
      setFullscreenActive(true)
    } catch {
      return
    }
  }

  const showFullscreenGate = !fullscreenActive && !session.frozen && session.status !== 'Completed' && !session.verification_required

  function focusQuestion(questionId: string) {
    setActiveQuestionId(questionId)
    document.getElementById(`question-${questionId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  function renderQuestionInput(question: QuestionRecord) {
    const answer = answers[question.id] ?? ''
    if (question.type === 'textarea' || question.type === 'short') {
      return (
        <textarea
          className={`question-input ${question.type === 'textarea' ? 'question-input-large' : ''}`}
          placeholder={question.placeholder}
          value={answer}
          onChange={(event) => {
            recordUserInteraction()
            onAnswerChange(question.id, event.target.value)
          }}
          onFocus={recordUserInteraction}
          disabled={session.frozen}
        />
      )
    }
    return (
      <div className="choice-group">
        {question.options.map((option) => (
          <label key={option.id} className="choice-item">
            <input
              type="radio"
              name={question.id}
              checked={answer === option.text}
              onChange={() => {
                recordUserInteraction()
                onAnswerChange(question.id, option.text)
              }}
              disabled={session.frozen}
            />
            <span>{option.label}. {option.text}</span>
          </label>
        ))}
      </div>
    )
  }

  return (
    <div className="candidate-workspace">
      {showFullscreenGate && (
        <div className="fullscreen-gate">
          <div className="fullscreen-gate-card">
            <div className="fullscreen-gate-icon">⛶</div>
            {fullscreenGraceCountdown !== null ? (
              <>
                <h2>You Exited Fullscreen</h2>
                <p>Return to fullscreen within <strong className="grace-countdown">{fullscreenGraceCountdown}s</strong> to avoid a security event being recorded.</p>
              </>
            ) : (
              <>
                <h2>Fullscreen Required</h2>
                <p>This exam must be taken in fullscreen mode. Exiting fullscreen is monitored and may affect your risk score.</p>
              </>
            )}
            <button className="primary-button" onClick={() => void enableFullscreen()}>
              {fullscreenGraceCountdown !== null ? 'Return to Fullscreen' : 'Enter Fullscreen & Continue'}
            </button>
          </div>
        </div>
      )}

      {session.frozen && (
        <div className="frozen-overlay">
          <div className="frozen-card">
            <div className="frozen-icon">!</div>
            <h2>Exam Suspended</h2>
            <p>
              Your exam session has been suspended by the invigilator. Please contact your
              invigilator immediately to resolve this issue before continuing.
            </p>
            <div className="frozen-card-actions">
              <div className="frozen-contact">Contact Invigilator</div>
              <button className="frozen-back-btn" onClick={onBackToDashboard}>Back to Dashboard</button>
            </div>
          </div>
        </div>
      )}

      {session.verification_required && (
        <StepUpModal
          method={config.step_up_method}
          referencePhoto={referencePhoto}
          stepUpCode={session.step_up_code_hint ?? null}
          stepUpCount={session.step_up_count ?? 0}
          onRiskEvent={onRiskEvent}
          onVerifyFace={onVerifyStepUpFace}
          onComplete={onCompleteStepUp}
        />
      )}

      <header className="exam-header">
        <div>
          <h1>{exam.title}</h1>
          <p>Total {exam.total_questions} questions, total score {exam.total_score} points</p>
        </div>
        <div className="exam-countdown">Exam Countdown {formatCountdown(displayRemaining)}</div>
      </header>

      {pageError && (
        <div className="top-notice">
          <span>{pageError}</span>
          <button className="text-link" onClick={onDismissError}>Dismiss</button>
        </div>
      )}

      {(session.risk_level !== 'Low' || session.proctor_notice || session.verification_required) && (
        <div className={`risk-banner risk-banner-${getRiskTone(session.risk_level)}`}>
          {session.proctor_notice || session.verification_reason || session.monitoring_status}
        </div>
      )}

      <div className="exam-body">
        <main className="question-column">
          {questions.map((question) => (
            <section
              key={question.id}
              id={`question-${question.id}`}
              className={`question-card ${activeQuestionId === question.id ? 'question-card-active' : ''}`}
              onMouseEnter={() => setActiveQuestionId(question.id)}
            >
              <div className="question-meta">
                <span className="question-number">{question.number}</span>
                <div>
                  <strong>{question.score} points</strong>
                  <span>{question.category}</span>
                </div>
              </div>
              <div className="question-content">
                <h2>{question.prompt}</h2>
                {renderQuestionInput(question)}
              </div>
            </section>
          ))}
        </main>

        <aside className="monitor-column">
          <div className="monitor-card">
            <div className="monitor-risk-row">
              <span className={`risk-badge risk-badge-${getRiskTone(session.risk_level)}`}>
                {session.risk_level}
              </span>
              <span className="monitor-score">{session.risk_score}</span>
            </div>
          </div>

          <div className="monitor-card">
            <div className="question-nav-grid">
              {questions.map((question) => {
                const answered = (answers[question.id] ?? '').trim() !== ''
                return (
                  <button
                    key={question.id}
                    className={`question-nav-button ${activeQuestionId === question.id ? 'question-nav-button-active' : ''} ${answered ? 'question-nav-button-answered' : ''}`}
                    onClick={() => focusQuestion(question.id)}
                  >
                    {question.number}
                  </button>
                )
              })}
            </div>
            <p className="monitor-answered">{session.answer_count} / {questions.length} answered</p>
            <button className="primary-button full-width" onClick={() => setShowSubmitConfirm(true)} disabled={session.frozen}>
              Submit Exam
            </button>
          </div>

          <div className="monitor-card monitor-card-warnings">
            <div className="warnings-title">Monitored Behaviours</div>
            <ul className="warnings-list">
              <li><span className="warn-pts warn-pts-high">+{config.session_weights['tab_switch'] ?? 22}</span> Tab / window switch</li>
              <li><span className="warn-pts warn-pts-high">+{config.session_weights['fullscreen_exit'] ?? 28}</span> Exiting fullscreen</li>
              <li><span className="warn-pts warn-pts-high">+{config.session_weights['copy_paste'] ?? 26}</span> Copy / paste attempt</li>
              <li><span className="warn-pts warn-pts-mid">+{config.session_weights['blur_focus'] ?? 15}</span> Exam window loses focus</li>
              <li><span className="warn-pts warn-pts-high">+{config.session_weights['page_refresh'] ?? 30}</span> Page refresh attempt</li>
            </ul>
            <p className="warnings-note">Risk ≥ {config.high_risk_threshold} triggers identity re-verification. Three verifications exhaust the limit and freeze this session.</p>
          </div>

          <button
            className="exit-exam-button full-width"
            onClick={() => setShowExitConfirm(true)}
            disabled={session.frozen}
          >
            Exit Exam
          </button>
        </aside>
      </div>

      {showSubmitConfirm && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Submit Examination</h3>
            <p>
              You have answered {session.answer_count} of {questions.length} questions. Are you
              ready to submit?
            </p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowSubmitConfirm(false)}>
                Continue Exam
              </button>
              <button className="primary-button" onClick={() => void onSubmit()}>
                Confirm Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {showExitConfirm && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Exit Exam</h3>
            <p>
              Are you sure you want to exit? <strong>This will count as abandoning the exam and
              your score will be recorded as 0.</strong> This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setShowExitConfirm(false)}>
                Stay in Exam
              </button>
              <button className="danger-button" onClick={() => void onSubmit()}>
                Exit &amp; Abandon
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
