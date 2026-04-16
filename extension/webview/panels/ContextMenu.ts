export interface MenuItemDef {
  type?: 'separator';
  label?: string;
  action?: () => void;
  color?: string;
  submenu?: MenuItemDef[];
}

export class ContextMenu {
  private static activeMenu: HTMLElement | null = null;
  private static cleanup: (() => void) | null = null;

  static show(x: number, y: number, items: MenuItemDef[]): void {
    ContextMenu.dismiss();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Context menu');

    for (const item of items) {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        continue;
      }

      const row = document.createElement('div');
      row.className = 'context-menu-item';
      row.setAttribute('role', 'menuitem');
      row.tabIndex = 0;

      if (item.color) {
        const swatch = document.createElement('span');
        swatch.className = 'context-menu-swatch';
        swatch.style.backgroundColor = item.color;
        row.appendChild(swatch);
      }

      const label = document.createElement('span');
      label.textContent = item.label || '';
      row.appendChild(label);

      if (item.submenu) {
        const arrow = document.createElement('span');
        arrow.className = 'context-menu-arrow';
        arrow.textContent = '\u25B6';
        row.appendChild(arrow);
        row.classList.add('has-submenu');

        const subMenuEl = ContextMenu.buildSubmenu(item.submenu);
        row.appendChild(subMenuEl);

        row.addEventListener('mouseenter', () => {
          subMenuEl.style.display = 'block';
          const rowRect = row.getBoundingClientRect();
          subMenuEl.style.left = `${row.offsetWidth}px`;
          subMenuEl.style.top = '0';
        });
        row.addEventListener('mouseleave', () => {
          subMenuEl.style.display = 'none';
        });
      } else if (item.action) {
        row.addEventListener('click', () => {
          item.action!();
          ContextMenu.dismiss();
        });
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            item.action!();
            ContextMenu.dismiss();
          }
        });
      }

      menu.appendChild(row);
    }

    // Position the menu
    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();

    let posX = x;
    let posY = y;
    if (posX + menuRect.width > bodyRect.width) posX = bodyRect.width - menuRect.width - 4;
    if (posY + menuRect.height > bodyRect.height) posY = bodyRect.height - menuRect.height - 4;
    if (posX < 0) posX = 4;
    if (posY < 0) posY = 4;

    menu.style.left = `${posX}px`;
    menu.style.top = `${posY}px`;

    ContextMenu.activeMenu = menu;

    const dismissHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        ContextMenu.dismiss();
      }
    };

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ContextMenu.dismiss();
    };

    setTimeout(() => {
      document.addEventListener('click', dismissHandler);
      document.addEventListener('keydown', keyHandler);
    }, 0);

    ContextMenu.cleanup = () => {
      document.removeEventListener('click', dismissHandler);
      document.removeEventListener('keydown', keyHandler);
    };
  }

  private static buildSubmenu(items: MenuItemDef[]): HTMLElement {
    const sub = document.createElement('div');
    sub.className = 'context-menu context-submenu';
    sub.setAttribute('role', 'menu');
    sub.style.display = 'none';

    for (const item of items) {
      if (item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        sub.appendChild(sep);
        continue;
      }

      const row = document.createElement('div');
      row.className = 'context-menu-item';
      row.setAttribute('role', 'menuitem');
      row.tabIndex = 0;

      if (item.color) {
        const swatch = document.createElement('span');
        swatch.className = 'context-menu-swatch';
        swatch.style.backgroundColor = item.color;
        row.appendChild(swatch);
      }

      const label = document.createElement('span');
      label.textContent = item.label || '';
      row.appendChild(label);

      if (item.action) {
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          item.action!();
          ContextMenu.dismiss();
        });
      }

      sub.appendChild(row);
    }

    return sub;
  }

  static dismiss(): void {
    if (ContextMenu.activeMenu) {
      ContextMenu.activeMenu.remove();
      ContextMenu.activeMenu = null;
    }
    if (ContextMenu.cleanup) {
      ContextMenu.cleanup();
      ContextMenu.cleanup = null;
    }
  }
}
