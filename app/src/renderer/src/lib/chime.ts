/**
 * Звуки уведомлений: `done` — агент закончил работу, `attention` — агент ждёт пользователя.
 */
export type ChimeTone = 'done' | 'attention'

interface Note {
  /** Частота в герцах. */
  frequency: number
  /** Начало от старта звука в секундах. */
  at: number
}

/**
 * Мелодии звуков: «готово» — восходящая кварта, спокойно и законченно; «ждёт тебя» —
 * два одинаковых коротких тона, как стук в дверь.
 */
const MELODIES: Record<ChimeTone, readonly Note[]> = {
  done: [
    { frequency: 659.25, at: 0 },
    { frequency: 880, at: 0.12 }
  ],
  attention: [
    { frequency: 783.99, at: 0 },
    { frequency: 783.99, at: 0.16 }
  ]
}

/** Громкость звука: он должен быть слышен, но не громче системных. */
const VOLUME = 0.12

/** Сколько звучит одна нота до полного затухания, в секундах. */
const NOTE_DURATION = 0.9

/** Нарастание ноты: без него в начале слышен щелчок. */
const NOTE_ATTACK = 0.008

/** Обертон на октаву выше придаёт тону мягкий «стеклянный» оттенок. */
const OVERTONE_LEVEL = 0.18

let context: AudioContext | null = null

/**
 * Играет короткий звук уведомления. Звук синтезируется на месте, поэтому приложению
 * не нужны звуковые файлы.
 */
export function playChime(tone: ChimeTone): void {
  context ??= new AudioContext()
  const audio = context
  // Контекст засыпает, пока окно долго без звука; будим его и играем, когда он проснётся.
  void audio.resume().then(() => {
    const start = audio.currentTime
    for (const { frequency, at } of MELODIES[tone]) {
      playNote(audio, frequency, start + at)
    }
  })
}

function playNote(audio: AudioContext, frequency: number, start: number): void {
  const envelope = audio.createGain()
  envelope.gain.setValueAtTime(0, start)
  envelope.gain.linearRampToValueAtTime(VOLUME, start + NOTE_ATTACK)
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_DURATION)
  envelope.connect(audio.destination)

  const voices: [number, number][] = [
    [frequency, 1],
    [frequency * 2, OVERTONE_LEVEL]
  ]
  for (const [voiceFrequency, level] of voices) {
    const oscillator = audio.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = voiceFrequency
    const gain = audio.createGain()
    gain.gain.value = level
    oscillator.connect(gain).connect(envelope)
    oscillator.start(start)
    oscillator.stop(start + NOTE_DURATION)
  }
}
