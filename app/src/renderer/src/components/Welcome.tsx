import { useState, type CSSProperties } from 'react'
import { formatShortcut } from '../../../shared/shortcuts'
import { useSettings } from '../hooks/SettingsContext'
import { useUserProfile } from '../hooks/useUserProfile'

/** Лепестки знака Atox: цвет и угол каждого, как в иконке приложения. */
const PETALS = [
  { color: '#ff6a3d', angle: 0 },
  { color: '#2f7dff', angle: 60 },
  { color: '#a24dff', angle: 120 }
] as const

/** Приветствие по времени суток: утро с 5 до 12, день до 18, дальше вечер. */
function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) {
    return 'Good morning'
  }
  if (hour >= 12 && hour < 18) {
    return 'Good afternoon'
  }
  return 'Good evening'
}

/** Знак Atox: при появлении лепестки раскрываются из одного в цветок. */
function BloomMark() {
  const petals = PETALS.map(({ color, angle }, index) => (
    <ellipse
      key={color}
      className="bloom-mark__petal"
      cx="50"
      cy="50"
      rx="13"
      ry="29"
      fill={color}
      style={{ '--petal-angle': `${angle}deg`, '--petal-index': index } as CSSProperties}
    />
  ))
  return (
    <svg className="bloom-mark" viewBox="0 0 100 100" aria-hidden>
      <g className="bloom-mark__glow">{petals}</g>
      <g className="bloom-mark__petals">{petals}</g>
    </svg>
  )
}

/** Пустая рабочая область: здоровается и подсказывает, как начать. */
export function Welcome() {
  const profile = useUserProfile()
  const { shortcuts } = useSettings()
  // Приветствие выбирается при открытии экрана и не меняется у пользователя на глазах.
  const [salutation] = useState(() => greeting(new Date().getHours()))
  const firstName = profile?.name.split(/\s+/)[0]

  return (
    <div className="welcome">
      <BloomMark />
      <h1 className="welcome__title">
        {firstName ? `${salutation}, ${firstName}` : salutation}
      </h1>
      <p className="welcome__hint">
        Pick a chat or press <kbd>{formatShortcut('newChat', shortcuts)}</kbd> to start a new one
      </p>
    </div>
  )
}
