import { useCallback, useEffect, useRef, useState } from 'react'

export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraReady(false)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      setCameraError('')
      if (streamRef.current) {
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      setCameraReady(true)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to access the webcam.'
      setCameraError(message)
      setCameraReady(false)
    }
  }, [])

  useEffect(() => {
    if (active) {
      const timer = window.setTimeout(() => {
        void startCamera()
      }, 0)
      return () => {
        window.clearTimeout(timer)
        stopCamera()
      }
    } else {
      const timer = window.setTimeout(() => {
        stopCamera()
      }, 0)
      return () => {
        window.clearTimeout(timer)
      }
    }
  }, [active, startCamera, stopCamera])

  const captureFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.92)
  }, [])

  return {
    videoRef,
    cameraReady,
    cameraError,
    startCamera,
    stopCamera,
    captureFrame,
  }
}
