# Classifica

Web app (HTML/CSS/JS, nessuna dipendenza) per tenere la classifica di 4 giocatori su iPhone.
Si installa sulla schermata Home come un'app e funziona anche offline.

## Provarla sul Mac

```bash
python3 -m http.server 8080
```

Poi apri http://localhost:8080.

## Installarla su iPhone

Per avere icona e funzionamento offline la app deve essere servita in **HTTPS**.
Il modo più semplice è GitHub Pages (gratis):

1. Crea un repository e carica tutti i file di questa cartella.
2. Settings → Pages → Branch `main`, cartella `/ (root)` → Save.
3. Apri l'indirizzo `https://<utente>.github.io/<repo>/` con **Safari** su iPhone.
4. Tasto Condividi → **Aggiungi alla schermata Home**.

## Dove sono salvati i dati

In `localStorage` del browser, solo sul telefono (nessun server).
L'app installata sulla Home ha una memoria separata da Safari: usa sempre l'icona.
Per sicurezza fai ogni tanto **Modifica → Esporta backup** (file JSON che puoi salvare in File/iCloud
e reimportare).

## Aggiornare l'app

Dopo aver modificato i file, cambia `CACHE` in `sw.js` (es. `classifica-v2`) e ricarica il sito.
