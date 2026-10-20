// 行内图标的最小本地实现：svg 结构、viewBox、path、stroke/fill 与颜色继承均拷贝自
// node_modules/@icon-park/react 的 Pin / CloseSmall，但不再经过其 IconWrapper（context/useMemo/随机 id）。
// 原实现额外渲染的 48×48 clipPath 对这两个 path 不产生任何裁剪（路径完全落在 viewBox 内），
// 因此省略以进一步减少每行的组件与 DOM 开销。
// 外层 span 的 i-icon 类名保留，确保 @icon-park/react/styles/index.css 的布局样式保持不变。

export interface RowIconProps {
  size?: number | string;
  theme?: "outline" | "filled";
}

const ICON_VIEW_BOX = "0 0 48 48";
const ICON_STROKE_WIDTH = 4;

const PIN_PATH_D =
  "M10.6963 17.5042C13.3347 14.8657 16.4701 14.9387 19.8781 16.8076L32.62 9.74509L31.8989 4.78683L43.2126 16.1005L38.2656 15.3907L31.1918 28.1214C32.9752 31.7589 33.1337 34.6647 30.4953 37.3032C30.4953 37.3032 26.235 33.0429 22.7171 29.525L6.44305 41.5564L18.4382 25.2461C14.9202 21.7281 10.6963 17.5042 10.6963 17.5042Z";

export function PinIcon({ size = "1em", theme = "outline" }: RowIconProps) {
  return (
    <span className="i-icon i-icon-pin">
      <svg width={size} height={size} viewBox={ICON_VIEW_BOX} fill="none">
        <path
          d={PIN_PATH_D}
          fill={theme === "filled" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={ICON_STROKE_WIDTH}
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function CloseSmallIcon({ size = "1em" }: RowIconProps) {
  return (
    <span className="i-icon i-icon-close-small">
      <svg width={size} height={size} viewBox={ICON_VIEW_BOX} fill="none">
        <path
          d="M14 14L34 34"
          stroke="currentColor"
          strokeWidth={ICON_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 34L34 14"
          stroke="currentColor"
          strokeWidth={ICON_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
