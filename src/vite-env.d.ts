/// <reference types="vite/client" />

interface Window {
  ort: any;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'img-comparison-slider': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        children?: React.ReactNode;
      };
    }
  }
}