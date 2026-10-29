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

Su un database **Supabase** condiviso, protetto da un PIN: tutti i telefoni vedono la stessa classifica.
Ogni telefono ne tiene anche una copia locale, così la classifica si vede pure offline
(ma per salvare modifiche serve la rete).

Se in `app.js` `SUPABASE_URL` e `SUPABASE_KEY` sono vuoti, i dati restano solo nel `localStorage`
del telefono, come nelle prime versioni.

### Configurare Supabase

1. Crea un progetto gratuito su [supabase.com](https://supabase.com).
2. Apri **SQL Editor**, incolla il contenuto di `supabase.sql`, sostituisci `CAMBIAMI` con il PIN
   (almeno 6 cifre) e premi **Run**. Il PIN non va scritto nel repository.
3. Da **Project Settings → API Keys** copia la *Project URL* e la *publishable key* in cima ad `app.js`.
4. Apri l'app **prima sul telefono che ha già la classifica**: se il database è vuoto, viene
   riempito con i dati di quel telefono. Gli altri telefoni, inserendo il PIN, scaricano quelli.

Per cambiare il PIN rilancia nello SQL Editor solo l'ultima istruzione di `supabase.sql`:
i telefoni lo richiederanno da soli.

Se due persone salvano nello stesso momento non si perde nulla: l'app riapplica la propria modifica
sui dati più recenti.

Per sicurezza fai ogni tanto **Modifica → Esporta backup** (file JSON che puoi salvare in File/iCloud
e reimportare).

## Aggiornare l'app

Dopo aver modificato i file, cambia `CACHE` in `sw.js` (es. `classifica-v2`) e ricarica il sito.
