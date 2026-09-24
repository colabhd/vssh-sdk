"""
vssh.progresso: o protocolo de progresso de um trabalho longo, uma linha no stdout.

    ::vssh-progresso {"feito":2472,"total":3862,"etapa":"transcrevendo"}

O trabalho imprime a linha, e quem o acompanha a lê. Numa fila de processamento, quem lê é o
portal, no log do container; na estação, é o backend do app, no stdout do processo que ele subiu.
O resto do stdout continua sendo texto para gente, e só a linha com o prefixo é dado.

    from vssh import progresso
    progresso.informar(2472, 3862, 'transcrevendo')      # dentro do trabalho
    p = progresso.ler(linha)                               # em quem acompanha: dict ou None

`feito` é obrigatório. `total` é opcional; sem ele não há porcentagem, e a bandeja desenha a faixa
indeterminada. `etapa` é um nome curto do que está acontecendo, até 64 caracteres. O leitor do
portal é `src/services/fila/progresso.ts`, com as mesmas regras.

Só biblioteca padrão, para caber dentro de qualquer imagem de container que tenha Python.
"""

import json
import sys

PREFIXO = '::vssh-progresso '
_TETO_DA_ETAPA = 64


def informar(feito, total=None, etapa=None, saida=None):
    """Imprime a linha de progresso e a despacha na hora: um stdout com buffer seguraria o
    progresso até o fim, que é quando ele deixa de servir."""
    obj = {'feito': feito}
    if total is not None:
        obj['total'] = total
    if etapa:
        obj['etapa'] = str(etapa)[:_TETO_DA_ETAPA]
    f = saida or sys.stdout
    f.write(PREFIXO + json.dumps(obj, separators=(',', ':'), ensure_ascii=False) + '\n')
    f.flush()


def ler(linha):
    """`{'feito', 'total', 'etapa'}` de uma linha de progresso válida, ou `None`."""
    if isinstance(linha, bytes):
        linha = linha.decode('utf-8', 'replace')
    linha = linha.rstrip('\r\n')
    if not linha.startswith(PREFIXO):
        return None
    try:
        obj = json.loads(linha[len(PREFIXO):])
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    feito = _numero(obj.get('feito'))
    if feito is None or feito < 0:
        return None
    total = obj.get('total')
    if total is not None:
        total = _numero(total)
        if total is None or total <= 0:
            return None
    etapa = obj.get('etapa')
    etapa = etapa.strip()[:_TETO_DA_ETAPA] if isinstance(etapa, str) and etapa.strip() else None
    return {'feito': feito, 'total': total, 'etapa': etapa}


def _numero(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v != v or v in (float('inf'), float('-inf')):
        return None
    return v
