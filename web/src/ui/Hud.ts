// The debug HUD. HTML/CSS only: src/ui imports ZERO three.js and scripts/check
// limits.mjs enforces it (ARCHITECTURE.md 2.2 rule 4). Backtick toggles it, and
// because it is DOM text a screenshot carries its own performance evidence.

export interface HudLine { label: string; value: string; warn?: boolean; }

export class Hud {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private visible = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'of-hud';
    this.body = document.createElement('pre');
    this.body.id = 'of-hud-body';
    this.root.appendChild(this.body);
    parent.appendChild(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? 'block' : 'none';
  }

  render(lines: HudLine[]): void {
    if (!this.visible) return;
    let out = '';
    for (const l of lines) {
      const pad = l.label.padEnd(15, ' ');
      out += l.warn ? `${pad}${l.value}   <!>\n` : `${pad}${l.value}\n`;
    }
    this.body.textContent = out;
  }

  /** Boot / fatal messages, shown before the first frame. */
  banner(text: string, error = false): void {
    this.body.textContent = text;
    this.root.style.color = error ? '#ff8a7a' : '';
    this.setVisible(true);
  }
}
