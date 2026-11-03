import type { SessionOutput, Sample } from './session.ts'

const ns = 'http://www.w3.org/2000/svg'
function shape(name: string, attributes: Record<string, string | number>, text?: string) {
  const element = document.createElementNS(ns, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  if (text) element.textContent = text
  return element
}

export function drawApparatus(svg: SVGSVGElement, output: SessionOutput) {
  const width = svg.clientWidth || 800
  const height = svg.clientHeight || 305
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const { physics } = output.config
  const { state } = output
  const scale = Math.min(
    (width - 100) / physics.track_length_m,
    (height - 65) / (2 * physics.rod_length_m),
  )
  const centerX = width / 2
  const centerY = height / 2 - 4
  const left = centerX - (physics.track_length_m * scale) / 2
  const right = centerX + (physics.track_length_m * scale) / 2
  const cartX = centerX + state.cart_x_m * scale
  const point = (radius: number) => ({
    x: cartX - radius * scale * Math.sin(state.theta_unwrapped_rad),
    y: centerY - radius * scale * Math.cos(state.theta_unwrapped_rad),
  })
  const end = point(physics.rod_length_m)
  const weight = point(physics.counterweight_position_m)
  const center = point(
    ((physics.rod_mass_kg * physics.rod_length_m) / 2 +
      physics.counterweight_mass_kg * physics.counterweight_position_m) /
      (physics.rod_mass_kg + physics.counterweight_mass_kg),
  )
  const items: SVGElement[] = [
    shape('rect', {
      x: left,
      y: centerY + 15,
      width: physics.safety_buffer_m * scale,
      height: 7,
      fill: '#f1d9a6',
    }),
    shape('rect', {
      x: right - physics.safety_buffer_m * scale,
      y: centerY + 15,
      width: physics.safety_buffer_m * scale,
      height: 7,
      fill: '#f1d9a6',
    }),
    shape('line', {
      x1: left,
      x2: right,
      y1: centerY + 19,
      y2: centerY + 19,
      stroke: '#8fa69b',
      'stroke-width': 2,
    }),
  ]
  for (
    let position = -physics.track_length_m / 2;
    position <= physics.track_length_m / 2 + 1e-9;
    position += 0.5
  ) {
    const x = centerX + position * scale
    items.push(
      shape('line', { x1: x, x2: x, y1: centerY + 19, y2: centerY + 25, stroke: '#8fa69b' }),
      shape(
        'text',
        { x, y: centerY + 41, 'text-anchor': 'middle', fill: '#52645f', 'font-size': 10 },
        `${position} m`,
      ),
    )
  }
  items.push(
    shape('rect', {
      x: cartX - 21,
      y: centerY - 10,
      width: 42,
      height: 24,
      rx: 4,
      fill: '#315f50',
    }),
    shape('circle', { cx: cartX - 13, cy: centerY + 15, r: 4, fill: '#385044' }),
    shape('circle', { cx: cartX + 13, cy: centerY + 15, r: 4, fill: '#385044' }),
    shape('line', {
      x1: cartX,
      y1: centerY,
      x2: end.x,
      y2: end.y,
      stroke: '#426d60',
      'stroke-width': 5,
      'stroke-linecap': 'round',
    }),
    shape('circle', {
      cx: cartX,
      cy: centerY,
      r: 4,
      fill: '#fff',
      stroke: '#244b3f',
      'stroke-width': 1.5,
    }),
    shape('circle', {
      cx: weight.x,
      cy: weight.y,
      r: physics.counterweight_mass_kg > 0 ? 7 : 0,
      fill: '#d7a34c',
      stroke: '#946519',
      'stroke-width': 1,
    }),
    shape('rect', {
      x: center.x - 3,
      y: center.y - 3,
      width: 6,
      height: 6,
      fill: '#fff',
      stroke: '#314d44',
      'stroke-width': 1.2,
    }),
  )
  svg.replaceChildren(...items)
}

export function drawChart(
  canvas: HTMLCanvasElement,
  samples: Sample[],
  field: keyof Sample,
  color: string,
  duration: number,
) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const ratio = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }
  const context = canvas.getContext('2d')
  if (!context || !width || !height) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  const left = 46,
    top = 18,
    bottom = height - 23,
    right = width - 12
  let min = Infinity,
    max = -Infinity
  for (const sample of samples) {
    const value = Number(sample[field])
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (!samples.length) {
    min = -1
    max = 1
  }
  const padding = Math.max((max - min) * 0.15, Math.abs(max) * 0.02, 0.002)
  min -= padding
  max += padding
  context.font = '10px -apple-system, sans-serif'
  context.lineWidth = 1
  for (let row = 0; row <= 2; row++) {
    const y = top + ((bottom - top) * row) / 2
    const value = max - ((max - min) * row) / 2
    context.strokeStyle = '#e7ece7'
    context.beginPath()
    context.moveTo(left, y)
    context.lineTo(right, y)
    context.stroke()
    context.fillStyle = '#586b63'
    context.textAlign = 'right'
    context.fillText(
      Math.abs(value) < 0.0001 ? '0' : value.toFixed(Math.abs(value) < 0.01 ? 3 : 2),
      left - 7,
      y + 3,
    )
  }
  context.textAlign = 'left'
  context.fillText('0', left, height - 6)
  context.textAlign = 'right'
  context.fillText(`${duration} s`, right, height - 6)
  if (!samples.length) {
    context.textAlign = 'center'
    context.fillText('开始后记录真实曲线', (left + right) / 2, (top + bottom) / 2)
    return
  }
  context.strokeStyle = color
  context.lineWidth = 1.7
  context.beginPath()
  samples.forEach((sample, index) => {
    const x = left + (sample.sim_time_s / duration) * (right - left)
    const y = bottom - ((Number(sample[field]) - min) / (max - min)) * (bottom - top)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.stroke()
}
