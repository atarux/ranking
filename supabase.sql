-- Database della classifica su Supabase.
-- Incolla tutto nello SQL Editor del progetto e premi Run.
-- PRIMA sostituisci CAMBIAMI (in fondo) con il PIN condiviso: almeno 6 cifre.
--
-- Le tabelle stanno nello schema "privato", che le API non espongono:
-- dall'app si passa solo dalle due funzioni pubbliche, che controllano il PIN.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists privato;
revoke all on schema privato from public, anon, authenticated;

-- Tutta la classifica in un unico documento JSON, con un numero di versione
-- che evita di sovrascrivere le modifiche fatte nel frattempo da un altro telefono.
create table if not exists privato.classifica (
  id int primary key default 1 check (id = 1),
  dati jsonb not null,
  versione int not null,
  aggiornata timestamptz not null default now()
);

create table if not exists privato.pin (
  id int primary key default 1 check (id = 1),
  hash text not null
);

-- PIN sbagliati recenti: oltre 30 in 15 minuti l'accesso si blocca per un po'.
create table if not exists privato.tentativi (
  ts timestamptz not null default now()
);

-- Restituisce null se il PIN è giusto, altrimenti il codice dell'errore.
-- Non usa eccezioni, così il tentativo sbagliato resta registrato.
create or replace function privato.verifica_pin(p_pin text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  delete from privato.tentativi where ts < now() - interval '1 day';
  if (select count(*) from privato.tentativi where ts > now() - interval '15 minutes') >= 30 then
    return 'troppi_tentativi';
  end if;
  if exists (select 1 from privato.pin where hash = extensions.crypt(p_pin, hash)) then
    return null;
  end if;
  perform pg_sleep(1);
  insert into privato.tentativi default values;
  return 'pin';
end $$;

create or replace function public.leggi_classifica(p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  errore text := privato.verifica_pin(p_pin);
  r privato.classifica;
begin
  if errore is not null then
    return jsonb_build_object('errore', errore);
  end if;
  select * into r from privato.classifica where id = 1;
  return jsonb_build_object('dati', r.dati, 'versione', coalesce(r.versione, 0));
end $$;

-- Salva solo se p_versione è ancora quella sul server; altrimenti risponde
-- 'conflitto' con i dati aggiornati, e l'app riapplica la modifica su quelli.
create or replace function public.salva_classifica(p_pin text, p_dati jsonb, p_versione int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  errore text := privato.verifica_pin(p_pin);
  nuova int;
  r privato.classifica;
begin
  if errore is not null then
    return jsonb_build_object('errore', errore);
  end if;
  if p_versione = 0 then
    insert into privato.classifica (id, dati, versione) values (1, p_dati, 1)
    on conflict (id) do nothing
    returning versione into nuova;
  else
    update privato.classifica
    set dati = p_dati, versione = versione + 1, aggiornata = now()
    where id = 1 and versione = p_versione
    returning versione into nuova;
  end if;
  if nuova is not null then
    return jsonb_build_object('versione', nuova);
  end if;
  select * into r from privato.classifica where id = 1;
  return jsonb_build_object('errore', 'conflitto', 'dati', r.dati, 'versione', coalesce(r.versione, 0));
end $$;

revoke all on function privato.verifica_pin(text) from public, anon, authenticated;
revoke all on function public.leggi_classifica(text) from public;
revoke all on function public.salva_classifica(text, jsonb, int) from public;
grant execute on function public.leggi_classifica(text) to anon, authenticated;
grant execute on function public.salva_classifica(text, jsonb, int) to anon, authenticated;

-- PIN condiviso. Per cambiarlo rilancia solo questa istruzione con il nuovo PIN.
insert into privato.pin (id, hash) values (1, extensions.crypt('CAMBIAMI', extensions.gen_salt('bf')))
on conflict (id) do update set hash = excluded.hash;
